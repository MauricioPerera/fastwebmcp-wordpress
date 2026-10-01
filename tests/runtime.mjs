import vm from 'node:vm';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const source=fs.readFileSync('assets/runtime.js','utf8');
function setup(supported=true){
 const tools=new Map(); let roots=[];
 const document={documentElement:{},dispatchEvent(){},querySelector(){return null;},querySelectorAll(){return roots;}};
 if(supported)document.modelContext={registerTool(tool,{signal}={}){tools.set(tool.name,tool);signal?.addEventListener('abort',()=>tools.delete(tool.name),{once:true});}};
 const window={FastWebMCPFrontend:{enabled:true}};
 const context={window,document,console,AbortController,AbortSignal,CustomEvent:class{},MutationObserver:class{observe(){}},setTimeout,clearTimeout};vm.runInNewContext(source,context);
 return{api:window.FastWebMCP,tools,roots(value){roots=value;}};
}
const {api,tools,roots}=setup();
const schema=api.schemaFromJSON({type:'object',additionalProperties:false,properties:{type:{type:'string',enum:['post','page']},count:{type:'integer',minimum:1,maximum:12}},required:['type','count']});
assert(schema.safeParse({type:'post',count:2}).success);assert(!schema.safeParse({type:'private',count:2}).success);assert(!schema.safeParse({type:'post',count:2.5}).success);assert(!schema.safeParse({type:'post',count:2,extra:1}).success);
assert.throws(()=>api.schemaFromJSON({type:'string',pattern:'x'}));assert.throws(()=>api.schemaFromJSON({type:'object',additionalProperties:true}));
const controller=new AbortController();await api.registerTool({name:'check',description:'Check',inputSchema:schema,execute:()=>true},{signal:controller.signal});
await assert.rejects(api.registerTool({name:'check',description:'Duplicate',inputSchema:schema,execute:()=>true}));
await assert.rejects(tools.get('check').execute({type:'private',count:2},{signal:new AbortController().signal}));controller.abort();assert(!tools.has('check'));
const root={isConnected:true,dataset:{},matches(){return true;}};roots([root]);let cleanup=0;const dispose=api.registerComponent('test','[data-test]',({registerTool})=>{void registerTool({name:'state',description:'State',inputSchema:api.z.object({}).strict(),execute:()=>true});return()=>cleanup++;});
assert.equal(api.components()[0].id,'test_1');root.isConnected=false;roots([]);api.reconcile();assert.equal(cleanup,1);assert(!tools.has('test_1_state'));root.isConnected=true;roots([root]);api.reconcile();assert.equal(api.components()[0].id,'test_2');dispose();assert.equal(cleanup,2);
const unsupported=setup(false);assert.equal(await unsupported.api.registerTool({name:'manual',description:'Manual',inputSchema:unsupported.api.z.object({}),execute:()=>true}),false);assert.equal(unsupported.api.supported(),false);
console.log('PASS: runtime schema, duplicate, cancellation, remount, disposal and missing-WebMCP checks');
