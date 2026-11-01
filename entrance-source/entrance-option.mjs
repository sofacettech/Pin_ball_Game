export function selectEntranceOption(search=''){
  const parameters=new URLSearchParams(search);
  const option=parameters.get('entrance')??parameters.get('version');
  return option==='2'||option==='3'?option:'1';
}
