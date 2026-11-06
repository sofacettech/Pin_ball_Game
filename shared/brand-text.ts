export const brandParts=(text:string)=>text.split(/(\bSO\s*\/?\s*(?:FACET|COINS)\b(?!\.[a-z]|[-/@:]))/gi).map((text,index)=>{
 const coin=index%2===1&&/COINS$/i.test(text),brand=index%2===1&&!coin;
 return {text:coin?'SO/ COINS':brand?'SO/ FACET':text,brand,coin};
});
export function setBrandText(element:HTMLElement,text:string){
 element.replaceChildren(...brandParts(text).map(part=>{
  if(!part.brand&&!part.coin)return document.createTextNode(part.text);
  const span=document.createElement('span');span.className=part.coin?'coin-word':'brand-word';span.textContent=part.text;return span;
 }));
}
