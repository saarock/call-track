const fs=require("node:fs"),path=require("node:path");
const parser=require("@babel/parser"),traverse=require("@babel/traverse").default;
const globals=new Set("React console window document navigator URL crypto global globalThis process __DEV__ fetch Headers Request Response AbortController File FileReader Blob Buffer atob btoa setTimeout clearTimeout setInterval clearInterval requestAnimationFrame cancelAnimationFrame performance alert confirm localStorage sessionStorage URLSearchParams indexedDB".split(" "));
const errors=[];
for(const dir of ["screens","context","components","navigation","services","utils","hooks"]){
 for(const name of fs.readdirSync(path.join(__dirname,"..",dir))){
  if(!/\.m?js$/.test(name))continue;
  const file=path.join(__dirname,"..",dir,name),ast=parser.parse(fs.readFileSync(file,"utf8"),{sourceType:"module",plugins:["jsx"]});
  const seen=new Set();
  const check=(name,node,scope)=>{if(globals.has(name)||scope.hasBinding(name)||seen.has(name))return;seen.add(name);errors.push(dir+"/"+path.basename(file)+":"+node.loc.start.line+" undefined "+name);};
  traverse(ast,{ReferencedIdentifier(p){check(p.node.name,p.node,p.scope);},JSXOpeningElement(p){const tag=p.node.name;if(tag.type==="JSXIdentifier"&&/^[A-Z]/.test(tag.name))check(tag.name,tag,p.scope);}});
 }
}
if(errors.length){console.error(errors.join("\n"));process.exit(1);}
console.log("Mobile source syntax and bindings passed.");

