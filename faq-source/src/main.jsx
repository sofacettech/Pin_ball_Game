import {brandText} from '../../shared/brand-react.jsx';
import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {sections} from './questions';
import {BrandText} from '../../assets/brand-text.jsx';
import './style.css';

const hashIndex = () => Math.max(0,sections.findIndex(section=>'#'+section.id===location.hash));

function App() {
  const [selected,setSelected]=useState(hashIndex);
  const [narrow,setNarrow]=useState(matchMedia('(max-width:560px)').matches);
  const [openQuestions,setOpenQuestions]=useState(()=>new Set(['the-basics-0']));
  const [printing,setPrinting]=useState(false);
  const tabs=useRef([]);
  useEffect(()=>{
    const media=matchMedia('(max-width:560px)'),resize=event=>setNarrow(event.matches);
    const hash=()=>setSelected(hashIndex());
    const beforePrint=()=>flushSync(()=>setPrinting(true)),afterPrint=()=>flushSync(()=>setPrinting(false));
    media.addEventListener('change',resize);window.addEventListener('hashchange',hash);
    window.addEventListener('beforeprint',beforePrint);window.addEventListener('afterprint',afterPrint);
    return ()=>{media.removeEventListener('change',resize);window.removeEventListener('hashchange',hash);window.removeEventListener('beforeprint',beforePrint);window.removeEventListener('afterprint',afterPrint)};
  },[]);
  function select(index,focus=false) {
    setSelected(index);history.replaceState(null,'','#'+sections[index].id);
    if(focus)tabs.current[index].focus();
  }
  function tabKey(event,index) {
    let next;
    if(['ArrowRight','ArrowDown'].includes(event.key))next=(index+1)%sections.length;
    if(['ArrowLeft','ArrowUp'].includes(event.key))next=(index+sections.length-1)%sections.length;
    if(event.key==='Home')next=0;
    if(event.key==='End')next=sections.length-1;
    if(event.key===' ')next=index;
    if(next!==undefined){event.preventDefault();select(next,true)}
  }
  function toggle(id,open) {
    if(printing)return;
    setOpenQuestions(previous=>{
      if(previous.has(id)===open)return previous;
      const next=new Set(previous);if(open)next.add(id);else next.delete(id);return next;
    });
  }
  return brandText(<>
    <a className="skip-link" href="#faq-content">Skip to questions</a>
    <div className="page enhanced">
      <header className="masthead"><a className="faq-brand site-brand" href="/" target="_top" aria-label="SOFACET home"><img src="/assets/sofacet-wordmark.svg" alt="SOFACET" width="2048" height="278"/></a><div className="breadcrumb">How points work / FAQ</div></header>
      <main>
        <section className="hero" aria-labelledby="page-title"><h1 id="page-title">Good questions.<em>Clear answers.</em></h1><p className="intro"><BrandText>A little more about the game, your points and everything SO/FACET.</BrandText></p></section>
        <div className="faq-layout" id="faq-content" tabIndex={-1}>
          <nav className="section-nav" aria-label="FAQ sections" role="tablist" aria-orientation={narrow?'horizontal':'vertical'}>
            {sections.map((section,index)=><a key={section.id} ref={element=>{tabs.current[index]=element}} id={section.tabId} href={'#'+section.id} role="tab" aria-controls={section.id} aria-selected={selected===index} tabIndex={selected===index?0:-1} onClick={event=>{event.preventDefault();select(index)}} onKeyDown={event=>tabKey(event,index)}><span aria-hidden="true">0{index+1} /</span><span className="nav-title">{section.navTitle}</span></a>)}
          </nav>
          <div className="panels">
            {sections.map((section,index)=><section key={section.id} className="faq-panel" id={section.id} aria-labelledby={section.tabId} role="tabpanel" tabIndex={0} hidden={selected!==index&&!printing}>
              <h2 className="panel-title">{section.title}</h2>
              {section.questions.map((question,i)=>{const id=section.id+'-'+i;return <details key={id} open={printing||openQuestions.has(id)} onToggle={event=>toggle(id,event.currentTarget.open)}><summary><span><BrandText>{question.question}</BrandText></span></summary><div className="answer"><p>{question.answer.map((part,j)=>typeof part==='string'?<BrandText key={j}>{part}</BrandText>:<a key={j} href={part.href}>{part.text}</a>)}</p></div></details>})}
            </section>)}
          </div>
        </div>
      </main>
      <footer><p>Still have a question?</p><a className="contact" href="mailto:hello@sofacet.com">hello@sofacet.com<svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M3 13 13 3M3 3h10v10" stroke="currentColor" strokeWidth="1.3"/></svg></a></footer>
    </div>
  </>);
}

createRoot(document.getElementById('faq-root')).render(<App/>);
