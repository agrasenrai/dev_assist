import type { VoiceDisplay } from '../voice-types.js';

export function PreviewQuestionGuide({display,onChoose}:{display:VoiceDisplay;onChoose:(question:string)=>void}) {
  const patient=display.tasks[0]?.patientName;
  const task=display.tasks.find(t=>t.status==='PENDING'||t.status==='IN_PROGRESS');
  const available=display.availableTasks?.[0];
  const groups=[
    {title:'Start a conversation',questions:['Hi Medi, how are you?',...(display.availableNurses||[]).map(n=>`My name is ${n.name}. What are my tasks?`)]},
    {title:'Explore your records',questions:['What tasks are pending?','Show my completed tasks',...(patient?[`Tell me about patient ${patient}`,'What are their allergies?']:[])]},
    {title:'Handoffs and extra work',questions:['Review my handoff','Show available tasks',...(available?[`Assign ${available.title} to me`]:[])]},
    {title:'Try a supported change',questions:display.pending?[...(display.pending.ready?['Confirm']:[]),'Cancel']:task?[`Mark ${task.title} completed`]:['Show my tasks']},
    {title:'Check the boundaries',questions:['Tell me about patient Nobody Example','Recommend treatment for this patient']},
  ];
  return <aside id="preview-guide" aria-label="What you can ask">
    <h2>What you can ask</h2>
    <p>Speak naturally, or select an example to edit below. Examples never send automatically.</p>
    {groups.map(group=><details key={group.title} open={display.nurse?group.title==='Explore your records':group.title==='Start a conversation'}>
      <summary>{group.title}</summary>
      {group.questions.map(question=><button type="button" key={question} onClick={()=>onChoose(question)}>{question}</button>)}
    </details>)}
    <p>Choose a nurse first. Patient follow-ups use the last patient discussed. Changes need your explicit confirmation. Missing records and clinical advice should receive an honest limitation.</p>
    <a href="/?workspace=simulations">Try interruption and recovery scenarios →</a>
  </aside>;
}
