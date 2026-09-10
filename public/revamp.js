const menu = document.querySelector('.menu');
const links = document.querySelector('.navlinks');
menu?.addEventListener('click', () => {
  const open = menu.getAttribute('aria-expanded') !== 'true';
  menu.setAttribute('aria-expanded', String(open));
  links.classList.toggle('open', open);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape' && menu?.getAttribute('aria-expanded') === 'true') {
    menu.setAttribute('aria-expanded', 'false'); links.classList.remove('open'); menu.focus();
  }
});
// Old bookmarked encyclopedia fragments keep their original behavior.
if (location.pathname === '/' && location.hash) location.replace('/encyclopedia' + location.hash);
const guideForm = document.querySelector('#guide-form');
const history = [];
guideForm?.addEventListener('submit', async event => {
  event.preventDefault();
  const input=document.querySelector('#guide-question'), button=guideForm.querySelector('button');
  const status=document.querySelector('#guide-status'), list=document.querySelector('#guide-messages');
  const question=input.value.trim(); if(!question || button.disabled)return;
  const user=document.createElement('p');user.textContent='You: '+question;list.append(user);
  const answer=document.createElement('p');answer.style.whiteSpace='pre-wrap';list.append(answer);
  button.disabled=true;status.textContent='Mary Jane is thinking…';
  let full='',done=false;
  const controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),60000);
  try{
    const response=await fetch('/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:[...history.slice(-10),{role:'user',content:question}]}),signal:controller.signal});
    if(!response.ok){let data;try{data=await response.json();}catch{}throw new Error(data?.error||'The guide is unavailable. Please try again later.');}
    if(!response.body)throw new Error('Streaming is unavailable in this browser.');
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    while(true){const part=await reader.read();if(part.done)break;buffer+=decoder.decode(part.value,{stream:true});const events=buffer.split('\n\n');buffer=events.pop();for(const item of events){if(!item.startsWith('data: '))continue;const data=item.slice(6).trim();if(data==='[DONE]'){done=true;continue;}const payload=JSON.parse(data);if(payload.error)throw new Error(payload.error);if(typeof payload.delta==='string'){full+=payload.delta;answer.textContent='Mary Jane: '+full;}}}
    if(!done||!full)throw new Error('The answer was interrupted. Please try again.');
    history.push({role:'user',content:question},{role:'assistant',content:full});input.value='';status.textContent='Answer complete. Check important claims against the reference sources.';
  }catch(error){status.textContent=error.name==='AbortError'?'The guide took too long to respond. Please try again.':error.message;}
  finally{clearTimeout(timeout);button.disabled=false;}
});
