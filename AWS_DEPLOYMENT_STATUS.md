# ShiftWeave AWS Deployment Record

This document records the deployment completed on **22 October 2026** and the
repeatable process for updating the online application.

The deployment is verified for **synthetic/demo use over temporary HTTP**. It
is not yet suitable for real credentials, PHI, or production clinical use
because no domain name or trusted HTTPS certificate has been configured.

## 1. What was deployed

ShiftWeave is running as a single ARM64 EC2 host:

```text
Public URL:       http://32.189.84.182
AWS account:      540087632943
AWS region:       us-west-2
Instance:         i-08e66aa7d1bdd0c6c
Instance type:    t4g.medium
Architecture:     arm64 / aarch64
Operating system: Amazon Linux 2023
```

The host runs two Docker Compose services:

```text
app    ShiftWeave application, Express APIs, React dashboard, MCP server,
       SQLite workflow state, mock agent, and optional provider adapters
https  Caddy reverse proxy
```

The application container is the only service that owns port 3000. Port 3000
is private to the Docker network. Caddy publishes ports 80 and 443, although
the current temporary configuration intentionally uses HTTP on port 80.

The deployed application image is:

```text
540087632943.dkr.ecr.us-west-2.amazonaws.com/shiftweave:2026-10-22-001
Digest: sha256:9f40c6076be6add0dd7bb4fca3c7777a50434fc0ca98d883fc1d2f219a1b623b
Platform: linux/arm64
```

## 2. AWS resources created

### Networking

| Resource | Value |
|---|---|
| VPC | `vpc-0a80e0608e3e39942` |
| VPC CIDR | `172.31.0.0/16` |
| Availability Zone | `us-west-2a` |
| Subnet | `subnet-004d0f024323006d5` |
| Subnet CIDR | `172.31.32.0/20` |
| Internet gateway | `igw-01e76bd637d1d06c5` |
| Security group | `sg-0d81a6e653de488e1` |
| Elastic IP | `32.189.84.182` |
| EIP allocation | `eipalloc-023d28d8be427e8cd` |
| EIP association | `eipassoc-0ea398b033891463a` |

Security-group ingress is:

```text
TCP 80  from 0.0.0.0/0
TCP 443 from 0.0.0.0/0
```

There is no inbound SSH rule and no inbound port 3000 rule. Administration is
performed through Systems Manager Session Manager and Run Command.

### IAM

The EC2 instance profile is:

```text
Role:            ShiftWeaveEC2Role
Role ARN:        arn:aws:iam::540087632943:role/ShiftWeaveEC2Role
Instance profile:ShiftWeaveEC2Role
```

The role currently has:

- `AmazonSSMManagedInstanceCore`
- ECR pull permissions scoped to the `shiftweave` repository
- Parameter Store read permissions scoped to
  `/shiftweave/production/*`
- S3 backup permissions scoped to the `shiftweave/*` prefix in the backup
  bucket

No long-lived AWS keys are stored in the container. The Account B Bedrock
caller role has not been created or enabled.

### ECR

```text
Repository: shiftweave
URI:        540087632943.dkr.ecr.us-west-2.amazonaws.com/shiftweave
Region:     us-west-2
Tag policy: immutable
Scan:       enabled on push
Encryption: AES256
```

The tag `2026-10-22-001` is immutable. Future builds must use a new tag.

### Storage

The root volume is an encrypted 16 GiB gp3 volume:

```text
Root volume: vol-0c06db877fa4790aa
```

The persistent application volume is:

```text
Volume:       vol-05a9a1f5a8249223b
Size:         32 GiB
Type:         gp3
Encrypted:    true
Device:       /dev/nvme1n1
Mount point:  /mnt/shiftweave
Filesystem:   XFS
UUID:         c7ca5e16-c484-4873-8560-1069301a945e
```

The mount is persisted in `/etc/fstab`. These paths are on the encrypted
volume:

```text
/mnt/shiftweave/.env.deploy
/mnt/shiftweave/compose.yaml
/mnt/shiftweave/Caddyfile
/mnt/shiftweave/storage
/mnt/shiftweave/backups
/mnt/shiftweave/keys
/mnt/shiftweave/caddy-data
/mnt/shiftweave/caddy-config
```

The baseline EBS snapshot is:

```text
Snapshot: snap-0ad3459f0d038f670
Volume:   vol-05a9a1f5a8249223b
State:    completed
Progress: 100%
Encrypted:true
Size:     32 GiB
```

### S3 backups

```text
Bucket: shiftweave-backups-540087632943-us-west-2
Prefix: shiftweave/
```

The bucket has:

- Public access blocked
- Versioning enabled
- AES256 server-side encryption
- Project/environment/purpose tags

Verified backup object:

```text
Key:        shiftweave/shiftweave-20261021T230945Z.db
Size:       278528 bytes
Encryption: AES256
VersionId:  TiQpUwXW27uLlctWP4zgmNSnUA8XjceR
```

The host also has a systemd timer named `shiftweave-backup.timer`. It runs at
02:15 UTC, creates a consistent SQLite backup, uploads it to S3, verifies the
object, and removes local backup files older than 14 days.

## 3. Deployment sequence completed

The following steps were completed and verified.

1. Confirmed AWS CLI access to Account A `540087632943`.
2. Confirmed `t4g.medium` availability and ARM64 architecture in
   `us-west-2`.
3. Created the immutable, encrypted ECR repository `shiftweave`.
4. Created a Docker Buildx builder supporting `linux/arm64`.
5. Built the Node 24 application image for ARM64.
6. Verified native `better-sqlite3` compatibility in the ARM64 image.
7. Ran the image locally with mock LLM and Epic disabled.
8. Confirmed local `/readyz` and MCP initialization.
9. Pushed image tag `2026-10-22-001` to ECR and recorded its digest.
10. Selected the public `us-west-2a` subnet and verified its internet route.
11. Created the public security group with only ports 80 and 443.
12. Created the EC2 trust role and instance profile.
13. Added ECR and Parameter Store permissions to the EC2 role.
14. Created the encrypted 32 GiB gp3 EBS volume.
15. Allocated and associated the Elastic IP.
16. Launched the ARM64 `t4g.medium` with IMDSv2 required and hop limit 2.
17. Attached the EBS data volume.
18. Confirmed Systems Manager agent status `Online`.
19. Identified `/dev/nvme1n1` without touching the root volume.
20. Formatted the blank data volume as XFS and mounted `/mnt/shiftweave`.
21. Installed Docker Engine and verified Docker on `aarch64`.
22. Installed and checksum-verified Docker Compose v5.6.1 for ARM64.
23. Authenticated to ECR and pulled the exact immutable image digest.
24. Created the versioned, encrypted S3 backup bucket.
25. Added least-privilege S3 backup permissions to the EC2 role.
26. Created production configuration in Parameter Store.
27. Retrieved parameters on EC2 without exposing secret values.
28. Created the EC2 Compose file and temporary HTTP Caddyfile.
29. Fixed persistent-directory ownership for the non-root application UID 1000.
30. Started the application and Caddy successfully.
31. Verified public `/readyz` with HTTP 200.
32. Verified authenticated `/health` with HTTP 200.
33. Verified MCP initialization and `tools/list` using protocol `2025-11-25`.
34. Verified the read-only `get_assigned_tasks` MCP tool.
35. Created and uploaded an encrypted SQLite backup to S3.
36. Enabled and tested the daily backup timer.
37. Created and completed the encrypted EBS baseline snapshot.

## 4. Current runtime configuration

The following safe defaults are active:

```text
LLM_PROVIDER=mock
EPIC_READS_ENABLED=false
EPIC_WRITES_ENABLED=false
EPIC_CREATE_REVIEW_TASKS=true
AWS_REGION=us-west-2
STAFF_AUTH_REQUIRED=false
```

Secrets are stored in Parameter Store under:

```text
/shiftweave/production/
```

The two sensitive values are `SecureString` parameters:

```text
/shiftweave/production/DEMO_PASSWORD
/shiftweave/production/MCP_AUTH_TOKEN
```

Do not copy these values into source control, Docker images, frontend variables,
chat messages, or documentation.

## 5. How to access the deployed project

### Browser access

Temporary demo URL:

```text
http://32.189.84.182
```

Anyone who knows the IP can reach port 80. Protected application routes still
require the configured demo credentials. The MCP endpoint requires the bearer
token.

This is HTTP, not HTTPS. Basic authentication credentials and MCP requests are
not encrypted in transit. Do not use real credentials or PHI at this URL.

### Readiness check

```powershell
Invoke-WebRequest -UseBasicParsing http://32.189.84.182/readyz
```

Expected response:

```json
{"ready":true}
```

### Authenticated health check

Retrieve the demo credentials from Parameter Store without printing them:

```powershell
$region = "us-west-2"
$demoUser = aws ssm get-parameter `
  --name "/shiftweave/production/DEMO_USER" `
  --with-decryption --region $region `
  --query "Parameter.Value" --output text
$demoPassword = aws ssm get-parameter `
  --name "/shiftweave/production/DEMO_PASSWORD" `
  --with-decryption --region $region `
  --query "Parameter.Value" --output text
$pair = "$demoUser`:$demoPassword"
$basicAuth = [Convert]::ToBase64String(
  [Text.Encoding]::ASCII.GetBytes($pair)
)
Invoke-WebRequest -UseBasicParsing `
  -Headers @{ Authorization = "Basic $basicAuth" } `
  http://32.189.84.182/health
```

### MCP access

The public MCP endpoint is:

```text
http://32.189.84.182/mcp
```

Clients must:

1. Send `Authorization: Bearer <MCP_AUTH_TOKEN>`.
2. Use `MCP-Protocol-Version: 2025-11-25`.
3. POST an `initialize` JSON-RPC request.
4. Retain the returned `mcp-session-id`.
5. Send `tools/list` and subsequent `tools/call` requests with that session ID.

The verified MCP tools include task reads, handoff context, draft creation,
checkpoint save/read, workflow resume, and human acknowledgement. The
application uses Streamable HTTP on `/mcp`; port 3000 is not public.

### AWS administration

Do not use SSH. The security group intentionally has no port 22 rule. Use:

```powershell
aws ssm describe-instance-information `
  --filters "Key=InstanceIds,Values=i-08e66aa7d1bdd0c6c" `
  --region us-west-2
```

All host commands in this deployment are run with `AWS-RunShellScript`:

```powershell
$commands = @(
  'docker compose -f /mnt/shiftweave/compose.yaml ps',
  'docker inspect shiftweave-app-1 --format "Health={{.State.Health.Status}}"'
)
@{commands=$commands} | ConvertTo-Json -Compress |
  Set-Content -Path .\ssm-check.json -Encoding ascii
$commandId = aws ssm send-command `
  --instance-ids i-08e66aa7d1bdd0c6c `
  --document-name AWS-RunShellScript `
  --parameters file://ssm-check.json `
  --region us-west-2 `
  --query "Command.CommandId" --output text
aws ssm wait command-executed `
  --command-id $commandId `
  --instance-id i-08e66aa7d1bdd0c6c `
  --region us-west-2
aws ssm get-command-invocation `
  --command-id $commandId `
  --instance-id i-08e66aa7d1bdd0c6c `
  --region us-west-2 `
  --query "{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}" `
  --output json
Remove-Item .\ssm-check.json -Force
```

## 6. How to publish a project update

The EC2 host runs an immutable ECR image. Updating local source files does not
change the online deployment. Use a new image tag for every deployment.

### Step 1: Test locally

From the repository root:

```powershell
npm run build
npm run preflight
npm run smoke
```

Run the focused tests relevant to the change before building the deployment
image. Keep Epic reads/writes disabled unless the change has an approved,
synthetic test plan.

### Step 2: Build a new ARM64 image

Use a new tag, for example `2026-10-22-002`:

```powershell
$tag = "2026-10-22-002"
$image = "540087632943.dkr.ecr.us-west-2.amazonaws.com/shiftweave:$tag"

docker buildx build `
  --builder shiftweave-builder `
  --platform linux/arm64 `
  --tag $image `
  --push `
  .
```

Verify the ECR digest:

```powershell
aws ecr describe-images `
  --repository-name shiftweave `
  --image-ids imageTag=$tag `
  --region us-west-2 `
  --query "imageDetails[0].{Digest:imageDigest,Tags:imageTags,Size:imageSizeInBytes,Status:imageStatus}" `
  --output json
```

Do not reuse `2026-10-22-001`; ECR tags are immutable.

### Step 3: Back up before replacing the running app

Run the existing backup service before a database migration or state-changing
deployment:

```powershell
$commands = @(
  'systemctl start shiftweave-backup.service',
  'systemctl show shiftweave-backup.service -p Result --value',
  'journalctl -u shiftweave-backup.service -n 20 --no-pager'
)
@{commands=$commands} | ConvertTo-Json -Compress |
  Set-Content -Path .\ssm-backup-before-update.json -Encoding ascii
$commandId = aws ssm send-command `
  --instance-ids i-08e66aa7d1bdd0c6c `
  --document-name AWS-RunShellScript `
  --parameters file://ssm-backup-before-update.json `
  --region us-west-2 `
  --query "Command.CommandId" --output text
aws ssm wait command-executed --command-id $commandId `
  --instance-id i-08e66aa7d1bdd0c6c --region us-west-2
aws ssm get-command-invocation --command-id $commandId `
  --instance-id i-08e66aa7d1bdd0c6c --region us-west-2 `
  --query "{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}" `
  --output json
Remove-Item .\ssm-backup-before-update.json -Force
```

### Step 4: Pull the new image on EC2

Replace `$tag` with the tag just pushed:

```powershell
$tag = "2026-10-22-002"
$image = "540087632943.dkr.ecr.us-west-2.amazonaws.com/shiftweave:$tag"

$commands = @(
  'set -eu',
  'export AWS_REGION=us-west-2',
  'export ECR_REGISTRY=540087632943.dkr.ecr.us-west-2.amazonaws.com',
  'export IMAGE=' + $image,
  'aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$ECR_REGISTRY" >/dev/null',
  'docker pull "$IMAGE"',
  'docker image inspect "$IMAGE" --format "Architecture={{.Architecture}} OS={{.Os}}"'
)
@{commands=$commands} | ConvertTo-Json -Compress |
  Set-Content -Path .\ssm-pull-update.json -Encoding ascii
$commandId = aws ssm send-command `
  --instance-ids i-08e66aa7d1bdd0c6c `
  --document-name AWS-RunShellScript `
  --parameters file://ssm-pull-update.json `
  --region us-west-2 `
  --query "Command.CommandId" --output text
aws ssm wait command-executed --command-id $commandId `
  --instance-id i-08e66aa7d1bdd0c6c --region us-west-2
aws ssm get-command-invocation --command-id $commandId `
  --instance-id i-08e66aa7d1bdd0c6c --region us-west-2 `
  --query "{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}" `
  --output json
Remove-Item .\ssm-pull-update.json -Force
```

### Step 5: Change the host Compose image and redeploy

This command replaces only the image reference. It preserves the EBS mount,
`.env.deploy`, Caddy data, SQLite database, and backups:

```powershell
$tag = "2026-10-22-002"
$commands = @(
  'set -eu',
  "sed -i -E 's#image: 540087632943.dkr.ecr.us-west-2.amazonaws.com/shiftweave:.*#image: 540087632943.dkr.ecr.us-west-2.amazonaws.com/shiftweave:$tag#' /mnt/shiftweave/compose.yaml",
  'docker compose -f /mnt/shiftweave/compose.yaml config --quiet',
  'docker compose -f /mnt/shiftweave/compose.yaml up -d --no-build app',
  'sleep 15',
  'docker compose -f /mnt/shiftweave/compose.yaml ps'
)
@{commands=$commands} | ConvertTo-Json -Compress |
  Set-Content -Path .\ssm-deploy-update.json -Encoding ascii
$commandId = aws ssm send-command `
  --instance-ids i-08e66aa7d1bdd0c6c `
  --document-name AWS-RunShellScript `
  --parameters file://ssm-deploy-update.json `
  --region us-west-2 `
  --query "Command.CommandId" --output text
aws ssm wait command-executed --command-id $commandId `
  --instance-id i-08e66aa7d1bdd0c6c --region us-west-2
aws ssm get-command-invocation --command-id $commandId `
  --instance-id i-08e66aa7d1bdd0c6c --region us-west-2 `
  --query "{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}" `
  --output json
Remove-Item .\ssm-deploy-update.json -Force
```

Do not run `docker compose down -v`. That can delete persistent Docker
volumes; the deployment intentionally uses host bind mounts on EBS.

### Step 6: Verify after every update

```powershell
Invoke-WebRequest -UseBasicParsing http://32.189.84.182/readyz
```

Then run the SSM checks:

```powershell
$commands = @(
  'docker compose -f /mnt/shiftweave/compose.yaml ps',
  'docker inspect shiftweave-app-1 --format "Health={{.State.Health.Status}}"',
  'docker exec shiftweave-app-1 node -e "fetch(\"http://127.0.0.1:3000/readyz\").then(async r=>{console.log(r.status); console.log(await r.text()); process.exit(r.ok?0:1)}).catch(e=>{console.error(e.message); process.exit(1)})"',
  'docker image inspect "$(docker inspect -f "{{.Config.Image}}" shiftweave-app-1)" --format "Image={{.RepoDigests}}"'
)
@{commands=$commands} | ConvertTo-Json -Compress |
  Set-Content -Path .\ssm-verify-update.json -Encoding ascii
$commandId = aws ssm send-command `
  --instance-ids i-08e66aa7d1bdd0c6c `
  --document-name AWS-RunShellScript `
  --parameters file://ssm-verify-update.json `
  --region us-west-2 `
  --query "Command.CommandId" --output text
aws ssm wait command-executed --command-id $commandId `
  --instance-id i-08e66aa7d1bdd0c6c --region us-west-2
aws ssm get-command-invocation --command-id $commandId `
  --instance-id i-08e66aa7d1bdd0c6c --region us-west-2 `
  --query "{Status:Status,Output:StandardOutputContent,Error:StandardErrorContent}" `
  --output json
Remove-Item .\ssm-verify-update.json -Force
```

Expected results:

```text
HTTP /readyz: 200
app: healthy
https: running
MCP: initialize 200, session ID returned
```

## 7. Production-readiness work still pending

The following are deliberately not complete:

1. **Domain and HTTPS:** obtain a domain, create an A record pointing to
   `32.189.84.182`, update the Caddyfile to the hostname, and let Caddy obtain
   a trusted certificate. Do not send real credentials over the current HTTP
   URL.
2. **Account B Bedrock:** create and test the cross-account caller role only
   if the optional Bedrock challenge is needed.
3. **Epic:** obtain a separate approved production Epic app, keys, JWKS,
   permissions, approved patient IDs, and a separate production database.
   Keep both Epic flags false until read-only synthetic validation succeeds.
4. **Observability:** add the planned CloudWatch logs, alarms, and CloudTrail
   coverage.
5. **Budgets and lifecycle:** configure account budgets, EBS snapshot
   retention, and S3 lifecycle rules appropriate to the desired retention.
6. **Recovery drill:** test restore from an S3 SQLite backup and from the EBS
   snapshot using an isolated volume or host. Do not test restoration over the
   live database.

## 8. Safety and operational rules

- Keep one application replica. SQLite and in-memory MCP sessions are
  single-host state.
- Keep MCP protocol version `2025-11-25` and Streamable HTTP on `/mcp`.
- Do not put Bedrock calls inside MCP tool handlers.
- Keep workflow mutations idempotent and checkpointed.
- Do not present missing Epic data as a verified negative.
- Do not enable Epic write-back without formal authorization, human review,
  remote reconciliation, and duplicate/ambiguous-outcome handling.
- Do not store secrets in Git, Dockerfiles, images, frontend bundles, or
  pasted command output.
- Do not run `docker compose down -v`.
- Create a backup before schema migrations, data imports, or state-changing
  deployments.
- Treat the current public HTTP deployment as synthetic/demo only.

## 9. Short status summary

> ShiftWeave is deployed and verified on an ARM64 AWS EC2 host with Docker,
> ECR, encrypted EBS-backed SQLite, SSM administration, encrypted/versioned S3
> backups, Caddy, public MCP Streamable HTTP, and mock-agent defaults. The
> deployment is operational for synthetic/demo testing over temporary HTTP.
> Trusted HTTPS, domain configuration, production Epic authorization, optional
> Bedrock cross-account access, and full production observability remain
> pending.
