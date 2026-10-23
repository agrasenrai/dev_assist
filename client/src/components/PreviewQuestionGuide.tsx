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
    <p>{display.nurse?'Speak naturally, or select an example to edit below.':'Start with a name, a question, or a simple hello.'} Examples never send automatically.</p>
    {groups.map(group=><details key={group.title} open={display.nurse?group.title==='Explore your records':group.title==='Start a conversation'||group.title==='Explore your records'}>
      <summary>{group.title}</summary>
      <div className="question-list">{group.questions.map(question=><button type="button" key={question} onClick={()=>onChoose(question)}>{question}</button>)}</div>
    </details>)}
    <p className="guide-note">{display.nurse?'Follow-ups use your current context. Changes need your explicit confirmation.':'Choose a nurse to open their workflow. Ask in your own words.'}</p>
    <a href="/?workspace=simulations">Try interruption and recovery scenarios →</a>
  </aside>;
}
