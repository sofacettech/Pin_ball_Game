const title="SO/ FACET. What's yours?";
const description='Play pinball, score points, and save them for SO/ FACET lab-grown diamond jewellery.';
const escape=value=>value.replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;');
export function withSiteMetadata(html,origin=process.env.SITE_URL||process.env.APP_ORIGIN||'https://shopsofacet.com'){
 let base='';
 if(origin){const url=new URL(origin);if(!['https:','http:'].includes(url.protocol))throw Error('The public site URL must use HTTPS or HTTP.');base=url.origin}
 html=String(html).replace(/<!-- site-metadata -->[\s\S]*?<!-- \/site-metadata -->/g,'').replace(/<link\b(?=[^>]*\brel=["'](?:icon|apple-touch-icon)["'])[^>]*>/gi,'').replace(/<meta\b(?=[^>]*(?:property|name)=["'](?:og:|twitter:)[^"']*["'])[^>]*>/gi,'');
 const image=escape(base+'/assets/sofacet-share.png');
 return html.replace('</head>',`<!-- site-metadata -->
<link rel="icon" href="/assets/sofacet-favicon.svg" type="image/svg+xml">
<link rel="icon" href="/assets/sofacet-favicon-32.png" type="image/png" sizes="32x32">
<link rel="apple-touch-icon" href="/assets/sofacet-touch-icon.png" sizes="180x180">
<meta property="og:type" content="website">
<meta property="og:site_name" content="SO/ FACET">
<meta property="og:title" content="${escape(title)}">
<meta property="og:description" content="${escape(description)}">
<meta property="og:image" content="${image}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="og:image:alt" content="SO/ FACET. What's yours? Play pinball. Save your points.">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="${escape(title)}">
<meta name="twitter:description" content="${escape(description)}">
<meta name="twitter:image" content="${image}">
<!-- /site-metadata --></head>`).replace(/[\t ]+$/gm,'');
}
