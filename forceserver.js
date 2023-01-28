/* forceserver.js */
const { parser } = require('@9r3i/parser');
const { ForceData } = require('@9r3i/forcedata');
const fs = require('fs').promises;

function ForceServer(req,res){
this.version='1.4.1';
this.req=req;
this.res=res;
this.parser=new parser;
this.fs=fs;
this.dir='./force/data/';
this.dirPlugins='./force/plugins/';
this.postMethods=['test'];
this.getMethods=['test'];
this.plugins={};
this.RAW_POST=null;
this.FILES=[];
/* initialize */
this.init=function(){
  /* check if headers are sent */
  if(this.res.headersSent){
    return;
  }
  /* set default headers */
  this.header();
  /* checking options */
  if(this.req.method=="OPTIONS"){
    this.res.setHeader("Content-Language","en-US");
    this.res.setHeader("Content-Encoding","gzip");
    this.res.setHeader("Content-Length","0");
    this.res.setHeader("Vary","Accept-Encoding, Origin");
    this.res.writeHead(200);
    this.res.end('');
    return;
  }
  /* check directory */
  const _this=this;
  fs.access(this.dir).then().catch(e=>{
    fs.mkdir(_this.dir,{mode:0o755,recursive:true});
  });
  fs.access(this.dirPlugins).then().catch(e=>{
    fs.mkdir(_this.dirPlugins,{mode:0o755,recursive:true});
  });
  /* parse POST data */
  if(this.req.method=='POST'){
    let body='';
    this.req.on('data',function(data){
      body+=data;
      if(body.length>8e6){
        _this.req.connection.destroy();
      }
    });
    this.req.on('end',function(){
      _this.RAW_POST=body;
      const ctype=_this.getRequestContentType(),
      curl='application/x-www-form-urlencoded',
      cjson='application/json',
      cpart=/^multipart\/form-data;\s*boundary=(.*)$/,
      cform=ctype.match(cpart);
      if(ctype&&ctype==curl){
        let query=_this.parser.parseQuery(body);
        return _this.postExec(query);
      }else if(ctype&&cform){
        const boundary=cform[1];
        let query=_this.parseMultipartData(body,boundary);
        return _this.postExec(query);
      }else if(ctype&&ctype==cjson){
        let query={};
        try{
          query=JSON.parse(body);
        }catch(e){
          query={};
        }
        return _this.postExec(query);
      }else if(ctype&&ctype=='text/plain'){
        let query=_this.parseTextData(body);
        return _this.postExec(query);
      }return _this.postExec({});
    });
    return;
  }
  /* parse request.url */
  const parsed=this.parser.parseURL(this.req.url);
  /* execute get request */
  return this.getExec(parsed.query);
};
/* parse text data */
this.parseTextData=function(data){
  const ptrn=/(\r\n|\r|\n)/,
  lrn=/\s*:\s*/,
  split=data.split(ptrn),
  res={};
  if(!split){return res;}
  for(let p of split){
    let line=p.split(lrn);
    if(line&&line.length>=2){
      res[line[0]]=line[1];
    }
  }return res;
};
/* parse multipart data */
this.parseMultipartData=function(data,boundary){
  const dash='--',
  fence=dash+boundary,
  closer=fence+dash,
  pdisp=/^Content-Disposition:\s*form-data;\s*name="([^"]+)"(;\s*filename="([^"]+)")?\s*$/i,
  ptype=/^Content-Type:\s*([a-z]+\/.*)\s*$/i,
  buffer=Buffer.from(data,'utf8'),
  query={},
  res=[];
  let line='',
  state=0,
  temp={
    header:{},
    data:[],
  };
  for(let i=0;i<buffer.length;i++){
    let l=i,
    lc=buffer[i],
    lp=i>0?buffer[i-1]:null,
    ln=lc==0x0a&&lp==0x0d,
    lr=lc==0x0a||lc==0x0d;
    if(!lr){
      line+=String.fromCharCode(lc);
    }
    if(state==0&&ln){
      if(line==fence){
        state=1;
      }line='';
    }else if(state==1&&ln){
      let lh=line.trim().match(pdisp);
      temp.header={
        name:lh[1],
        filename:lh[3]?lh[3]:null,
        type:'text/plain',
        size:0,
      };
      state=2;
      line='';
    }else if(state==2&&ln){
      let lh=line.trim().match(ptype);
      if(lh){
        temp.header.type=lh[1];
        state=3;
      }else{
        state=4;
      }line='';
    }else if(state==3&&ln){
      temp.data=[];
      state=4;
      line='';
    }else if(state==4){
      if(line.length>closer.length){
        line='';
      }
      if(line==fence){
        let dlen=temp.data.length-line.length,
        td=new TextDecoder,
				pdata=temp.data.slice(0,dlen-1),
				bdata=Buffer.from(pdata,'utf8');
				temp.header.size=dlen;
				if(temp.header.filename){
  				res.push({
	  			  header:temp.header,
		   		  data:bdata,
		   		  dataArray:pdata,
			  	  text:temp.header.type.match(/^text\//)
			  	    ?td.decode(bdata):null,
			  	});
				}else{
				  query[temp.header.name]=td.decode(bdata);
				}
				line='';
				state=5;
				temp={
				  header:{},
				  data:[],
				};
      }else{
        temp.data.push(lc);
      }
      if(ln){
        line='';
      }
    }else if(state==5&&ln){
      state=1;
    }
  }
  this.FILES=res;
  return query;
};
/* Content-Type */
this.getRequestContentType=function(){
  let res=false,key=false,
  ptrn=/^Content\-Type$/i;
  for(let head of this.req.rawHeaders){
    if(key){
      res=head;
      break;
    }else if(ptrn.test(head)){
      key=head;
    }
  }return res;
};
/* test */
this.test=function(req,method){
  const out=(new parser).parseJSON(req,9);
  return out;
};
/* get exec */
this.getExec=function(query){
  if(query.hasOwnProperty('method')
    &&this.getMethods.indexOf(query.method)>=0
    &&this.hasOwnProperty(query.method)
    &&typeof this[query.method]==='function'){
    const method=query.method;
    delete query.method;
    const res=this[method].apply(this[method],[query,'GET']);
    return this.out(res);
  }else if(this.pluginable(query)){
    return this.pluginExec(query,'GET');
  }
  const out='Error: 401 Unauthorized.';
  return this.out(out,401);
};
/* post exec */
this.postExec=function(query){
  console.log(query,this.FILES);
  if(query.hasOwnProperty('token')
    &&query.hasOwnProperty('method')
    &&this.validToken(query.token)
    &&this.postMethods.indexOf(query.method)>=0
    &&this.hasOwnProperty(query.method)
    &&typeof this[query.method]==='function'){
    const method=query.method;
    delete query.token;
    delete query.method;
    const res=this[method].apply(this[method],[query,'POST']);
    return this.out(res);
  }else if(this.pluginable(query,true)){
    return this.pluginExec(query,'POST');
  }
  const out='Error: 401 Unauthorized.';
  return this.out(out,401);
};
/* plugin exec */
this.pluginExec=async function(query,reqMethod){
  const ptrn=/^([0-9a-z_]+)\.([0-9a-z_]+)$/i,
  match=query.method.match(ptrn);
  delete query.token;
  delete query.method;
  const cname=match[1],
  method=match[2],
  args=query,
  pre={
    ForceServer:this,
    ForceData:ForceData,
    dir:this.dir,
    fs:this.fs,
  };
  if(typeof this.plugins[cname]!=='function'){
    return this.out('Error: Plugin is not available.');
  }
  const plug=new this.plugins[cname](args,reqMethod,pre),
  pkey=reqMethod=='POST'?'postMethods':'getMethods',
  pmet=plug.hasOwnProperty(pkey)?plug[pkey]:[];
  if(pmet.indexOf(method)<0
    ||typeof plug[method]!=='function'){
    return this.out('Error: Invalid request method.');
  }
  if(plug.hasOwnProperty('direct')
    &&Array.isArray(plug.direct)
    &&plug.direct.indexOf(method)>=0){
    return plug[method](args,reqMethod,pre);
  }
  const res=await plug[method](args,reqMethod,pre);
  return this.out(res);
};
/* pluginable */
this.pluginable=function(query,post){
  const ptrn=/^([0-9a-z_]+)\.([0-9a-z_]+)$/i;
  if(query.hasOwnProperty('method')
    &&ptrn.test(query.method)){
    if(!post){
      return true;
    }else if(query.hasOwnProperty('token')
      &&this.validToken(query.token)){
      return true;
    }
  }return false;
};
/* validate token -- stand-alone */
this.validToken=function(token){
  token=typeof token==='string'?token.toLowerCase():'';
  const time=parseInt(token,36,10),
  tnow=(new Date).getTime()/1000;
  return time>tnow?true:false;
};
/* extend response output */
this.out=function(str,code=200){
  const json=JSON.stringify(str),
  err='Error: Something is going wrong.',
  out=json?json:err;
  return this.output(out,code);
};
/* basic response output */
this.output=function(str,code=200){
  str=typeof str==='string'?str:'';
  if(this.res.headersSent){
    return;
  }
  let size=Buffer.from(str).length;
  this.res.setHeader("Content-Length",size);
  this.res.writeHead(code);
  this.res.end(str);
  return;
};
/* default headers */
this.header=function(){
  /* access control - to allow the access via ajax */
  this.res.setHeader("Access-Control-Allow-Origin","*"); // allow origin
  this.res.setHeader("Access-Control-Request-Method","POST, GET, OPTIONS"); // request method
  this.res.setHeader("Access-Control-Request-Headers","X-PINGOTHER, Content-Type"); // request header
  this.res.setHeader("Access-Control-Max-Age","86400"); // max age (24 hours)
  this.res.setHeader("Access-Control-Allow-Credentials","true"); // allow credentials
  /* set content type of response header */
  this.res.setHeader("Content-Type","text/plain;charset=utf-8;");
};
}

exports.ForceServer=ForceServer;

