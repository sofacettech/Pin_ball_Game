import React, {useEffect, useRef, useState} from 'react';
import {createRoot} from 'react-dom/client';
import {flushSync} from 'react-dom';
import {BrandText} from '../../assets/brand-text.jsx';
import {brandText} from '../../shared/brand-react.jsx';
import {sections} from './questions';
import './style.css';
import {setScreenRoute} from '../../site-routes.js';

const topics = [
  {...sections[0], icon: 'basics.png', alias: 'basics'},
  {...sections[1], navTitle: 'The game & your SO/ COINS', icon: 'game.svg', alias: 'games'},
  {...sections[2], icon: 'details.png', alias: 'details'},
  {id: 'contact', navTitle: 'Contact us', alias: 'contact'},
];
const topicFromHash = () => {
  if(location.pathname==='/contact')return 'contact';
  const hash = location.hash.slice(1);
  if (!hash || hash === 'faqs') return null;
  return topics.find(topic => [topic.id, 'topic-'+topic.alias, 'faq-'+topic.alias].includes(hash))?.id;
};

const socials = [
  {name: 'Instagram', href: 'https://www.instagram.com/so.facet', icon: <><rect x="3" y="3" width="26" height="26" rx="7"/><circle cx="16" cy="16" r="6"/><circle className="fill" cx="24" cy="8" r="2"/></>},
  {name: 'Facebook', href: 'https://www.facebook.com/share/1QffTGMswT/', icon: <path className="fill" d="M19 31V17h4l1-5h-5V9c0-1.4.4-2 2-2h3V2h-4c-4.5 0-7 2.7-7 7v3H9v5h4v14z"/>},
  {name: 'X', href: 'https://x.com/so_facet', icon: <path className="fill" d="M25.2 1.5h4.9L19.4 13.8 32 30.5h-9.9l-7.7-10.1-8.8 10.1H.6l11.5-13.1L0 1.5h10.1l7 9.2Zm-1.7 26h2.7L8.6 4.3H5.7Z"/>},
  {name: 'YouTube', href: 'https://www.youtube.com/@so_facet', icon: <><rect className="fill" x="1" y="5" width="30" height="22" rx="5"/><path className="cutout" d="m13 10 10 6-10 6z"/></>},
  {name: 'LinkedIn', href: 'https://www.linkedin.com/company/so-facet/', icon: <><rect className="fill" x="2" y="2" width="28" height="28" rx="2"/><circle className="cutout" cx="9" cy="10" r="2"/><path className="cutout-stroke" d="M9 15v11m7 0V15m0 5c0-7 9-7 9 0v6"/></>},
];

function FooterColumn({title, mobile, children}) {
  return mobile
    ? <details className="footer-column"><summary>{title}</summary><ul>{children}</ul></details>
    : <section className="footer-column"><h2>{title}</h2><ul>{children}</ul></section>;
}

function Footer({mobile, onTopic}) {
  function topicLink(event, id) {
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onTopic(id);
  }
  return <footer className="site-footer">
    <div className="footer-inner">
      <section className="collective-invite" aria-label="Join THE SO/ COLLECTIVE" data-join-for-guests>
        <a href="/join" target="_top">JOIN THE SO/ COLLECTIVE <span aria-hidden="true">→</span></a>
      </section>
      <div className="footer-menu">
        <FooterColumn title="Customer" mobile={mobile}>
          <li><a href="/contact" onClick={event => topicLink(event,'contact')}>Contact us</a></li>
          <li><a href="mailto:hello@sofacet.com">Email us</a></li>
          <li><a href="/how-coins-work" onClick={event => topicLink(event,null)}>Help &amp; FAQs</a></li>
        </FooterColumn>
        <FooterColumn title="Our company" mobile={mobile}>
          <li><a href="/about" target="_top"><BrandText>About SO/ FACET</BrandText></a></li>
          <li><a href="/how-coins-work#game-and-points" onClick={event => topicLink(event,'game-and-points')}>The game &amp; your SO/ COINS</a></li>
          <li><a href="/how-coins-work#your-details" onClick={event => topicLink(event,'your-details')}>Your details</a></li>
        </FooterColumn>
        <FooterColumn title="Legal and privacy" mobile={mobile}>
          <li><a href="/terms">Terms</a></li>
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/privacy#privacy-9-cookies-pixels-and-similar-technologies" data-cookie-settings>Cookie settings</a></li>
          <li><a href="mailto:privacy@sofacet.com">Data requests</a></li>
        </FooterColumn>
        <section className="footer-social">
          <h2>Follow us</h2>
          <div className="social-icons" role="group" aria-label="Social media">
            {socials.map(({name,href,icon}) => {
              const svg = <svg viewBox="0 0 32 32" aria-hidden="true">{icon}</svg>;
              return href
                ? <a key={name} href={href} target="_blank" rel="noopener noreferrer" aria-label={name}>{svg}</a>
                : <span key={name} role="img" aria-label={name}>{svg}</span>;
            })}
          </div>
        </section>
      </div>
      <div className="footer-bottom">
        <div className="footer-contact"><span>Still have a question?</span><a href="mailto:hello@sofacet.com">hello@sofacet.com</a></div>
        <a className="pinball" href="/game" target="_top">Play Pinball <span aria-hidden="true">→</span></a>
      </div>
    </div>
  </footer>;
}

function App() {
  const [selected,setSelected] = useState(() => topicFromHash() ?? null);
  const [mobile,setMobile] = useState(() => matchMedia('(max-width: 700px)').matches);
  const [openQuestions,setOpenQuestions] = useState(() => new Set(sections[0].questions.map((_, index) => 'the-basics-'+index)));
  const [printing,setPrinting] = useState(false);
  const main = useRef(null);
  const buttons = useRef([]);

  useEffect(() => {
    if(topicFromHash()==='contact'&&location.pathname!=='/contact')setScreenRoute('/contact');
    const media = matchMedia('(max-width: 700px)');
    const resize = event => setMobile(event.matches);
    const hash = () => {
      const id = topicFromHash();
      if (id !== undefined) setSelected(id);
    };
    if (topicFromHash()) main.current.scrollIntoView({block:'start'});
    const beforePrint = () => flushSync(() => setPrinting(true));
    const afterPrint = () => flushSync(() => setPrinting(false));
    media.addEventListener('change',resize);
    addEventListener('hashchange',hash);
    addEventListener('popstate',hash);
    addEventListener('beforeprint',beforePrint);
    addEventListener('afterprint',afterPrint);
    return () => {
      media.removeEventListener('change',resize);
      removeEventListener('hashchange',hash);
      removeEventListener('popstate',hash);
      removeEventListener('beforeprint',beforePrint);
      removeEventListener('afterprint',afterPrint);
    };
  },[]);

  function select(id,fromFooter=false) {
    setSelected(id);
    const href=(id==='contact'?'/contact':'/how-coins-work')+location.search+(id&&id!=='contact'?'#'+id:'');
    if (location.pathname+location.search+location.hash !== href) {
      if (window.sofacetGameInfo) window.sofacetGameInfo.visit(href);
      else history.pushState(history.state,'',href);
    }
    if (fromFooter) {
      main.current.focus({preventScroll:true});
      main.current.scrollIntoView({block:'start'});
    }
  }

  function topicKey(event,index) {
    let next;
    if (['ArrowRight','ArrowDown'].includes(event.key)) next = (index + 1) % topics.length;
    if (['ArrowLeft','ArrowUp'].includes(event.key)) next = (index + topics.length - 1) % topics.length;
    if (event.key === 'Home') next = 0;
    if (event.key === 'End') next = topics.length - 1;
    if (next === undefined) return;
    event.preventDefault();
    buttons.current[next].focus();
    select(topics[next].id);
  }

  function toggleQuestion(id,open) {
    if (printing) return;
    setOpenQuestions(previous => {
      if (previous.has(id) === open) return previous;
      const next = new Set(previous);
      if (open) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  return brandText(<>
    <a className="faq-skip" href="#faqs">Skip to FAQs</a>
    <a className="site-brand" href="/" target="_top" aria-label="SO/ FACET home"><img src="/assets/sofacet-wordmark.svg" alt="SO/ FACET" width="2048" height="278"/></a>
    <main className={'faq-main'+(selected?' is-open':'')} id="faqs" ref={main} tabIndex={-1}>
      <div className="faq-intro">
        <h1>HOW SO/ COINS WORK</h1>
        <p><BrandText>A little more about the game, your SO/ COINS and SO/ FACET.</BrandText></p>
      </div>
      <nav className="help-grid" aria-label="Help topics">
        {topics.map((topic,index) => <button className="tile" key={topic.id} id={'topic-'+topic.alias} type="button"
          ref={node => {buttons.current[index]=node}} aria-pressed={selected===topic.id} aria-controls={topic.id}
          onClick={() => select(topic.id)} onKeyDown={event => topicKey(event,index)}>
          {topic.icon
            ? <img src={'/assets/faq/'+topic.icon} width="48" height="48" alt=""/>
            : <svg viewBox="0 0 48 48" aria-hidden="true"><rect x="3" y="11" width="42" height="27"/><path d="M3 12 24 30 45 12"/></svg>}
          <span className="tile-number" aria-hidden="true">0{index+1}</span><span className="tile-label">{topic.alias==='games'?<>The game &amp;<br/><span className="tile-label-line">Your SO/ COINS</span></>:topic.navTitle}</span>
        </button>)}
      </nav>
      <div className="faq-shell" hidden={!selected&&!printing}>
        {topics.map(topic => <section className="faq-panel" key={topic.id} id={topic.id} aria-labelledby={'topic-'+topic.alias} hidden={selected!==topic.id&&!printing}>
          {topic.questions ? <>
            <h2 className="faq-panel-title">{topic.title}</h2>
            {topic.questions.map((question,index) => {
              const id = topic.id+'-'+index;
              return <details key={id} open={printing||openQuestions.has(id)} onToggle={event=>toggleQuestion(id,event.currentTarget.open)}>
                <summary><span><BrandText>{question.question}</BrandText></span></summary>
                <p>{question.answer.map((part,i) => typeof part==='string'
                  ? <BrandText key={i}>{part}</BrandText>
                  : <a key={i} href={part.href}>{part.text}</a>)}</p>
              </details>;
            })}
          </> : <>
            <h2>Still have a question?</h2>
            <p>Email us at <a href="mailto:hello@sofacet.com">hello@sofacet.com</a>.</p>
            <p>For updates or data requests, email <a href="mailto:privacy@sofacet.com">privacy@sofacet.com</a>.</p>
          </>}
        </section>)}
      </div>
    </main>
    <Footer mobile={mobile} onTopic={id => select(id,true)}/>
  </>);
}

createRoot(document.getElementById('faq-root')).render(<App/>);
