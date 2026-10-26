import {posix} from 'node:path'
import {Parser, DomHandler, DomUtils} from 'htmlparser2'
import {parse, walk, tokenize, tokenTypes} from 'css-tree'
import {POLICY, artifactBytes, decode, mime} from './protocol.mjs'
const PRESENTATION_LIMITS=Object.freeze({operations:100000,importDepth:16,elementDepth:128})

// No network fetches, CORS, origin privileges or wider CSP: static resources are
// embedded from this already-authorized immutable artifact. Only page navigation
// uses scoped URLs and therefore rechecks owner/digest/expiry on every page load.
export function previewFile(artifact, requested, prefix) {
  artifactBytes(artifact)
  const files=new Map(artifact.files.map(file=>[file.path,file]))
  const find=path=>files.get(path) ?? files.get((path ? path.replace(/\/$/,'')+'/' : '')+'index.html')
  const file=find(requested)
  if (!file) return undefined
  let work=0,expanded=0
  const bounded=value=>{
    expanded+=Buffer.byteLength(value)
    if (expanded>POLICY.artifactBytes || ++work>PRESENTATION_LIMITS.operations) throw new Error('Preview limit')
    return value
  }
  const tick=()=>{if(++work>PRESENTATION_LIMITS.operations)throw new Error('Preview work limit')}
  const text=file=>decode(file.data,POLICY.artifactBytes).toString('utf8')
  const resolve=(value,from)=>{
    tick()
    // Deliberately no encoded aliases, credentials, query strings or protocols.
    // Do not let URL's normalization turn above-root traversal into a capability.
    if (!value || /[\\%?\u0000-\u0020\u007f]/.test(value) || value.startsWith('//') || /^[^/]*:/.test(value)) return undefined
    const at=value.indexOf('#'),fragment=at<0?'':value.slice(at),path=at<0?value:value.slice(0,at)
    if(!path)return {file:files.get(from),path:from,fragment}
    const parts=path.startsWith('/')?[]:posix.dirname(from).split('/').filter(p=>p!=='.')
    for(const part of path.split('/')) {
      if(!part || part==='.')continue
      if(part==='..'){if(!parts.length)return undefined;parts.pop()}else parts.push(part)
    }
    const target=parts.join('/'),admitted=find(target)
    return admitted?{file:admitted,path:target,fragment}:undefined
  }
  const data=(value,from)=>{
    const target=resolve(value,from)
    if(!target || !/^(?:image\/|font\/)/.test(mime(target.file.path)))return ''
    return bounded(`data:${mime(target.file.path)};base64,${target.file.data}`)
  }
  const css=(source,from,parents=[],context='stylesheet')=>{
    if(parents.includes(from) || parents.length>=PRESENTATION_LIMITS.importDepth)throw new Error('Cyclic stylesheet')
    // Tokenize incrementally BEFORE AST allocation. A byte cap alone permits
    // hundreds of thousands of tiny rules and can OOM the shared API process.
    const closing=[]
    const pairs=new Map([[tokenTypes.Function,tokenTypes.RightParenthesis],[tokenTypes.LeftParenthesis,tokenTypes.RightParenthesis],[tokenTypes.LeftSquareBracket,tokenTypes.RightSquareBracket],[tokenTypes.LeftCurlyBracket,tokenTypes.RightCurlyBracket]])
    const ends=new Set(pairs.values())
    tokenize(source,type=>{
      tick()
      if(pairs.has(type)) {
        closing.push(pairs.get(type))
        if(closing.length>PRESENTATION_LIMITS.elementDepth)throw new Error('Preview depth limit')
      }else if(ends.has(type) && closing.pop()!==type)throw new Error('Invalid stylesheet nesting')
    })
    if(closing.length)throw new Error('Invalid stylesheet nesting')
    const ast=parse(source,{positions:true,context}),edits=[]
    walk(ast,function(node){
      tick()
      if(node.type==='Atrule' && node.name.toLowerCase()==='import') {
        const nodes=node.prelude?.children?.toArray() ?? [],first=nodes[0]
        // Static @import URL only. External/unsupported imports remain inert.
        const target=['Url','String'].includes(first?.type)?resolve(first.value,from):undefined
        if(nodes.length>1)throw new Error('Unsupported stylesheet import')
        const replacement=target && target.file.path.endsWith('.css')?css(text(target.file),target.file.path,[...parents,from]):''
        edits.push({start:node.loc.start.offset,end:node.loc.end.offset,value:replacement})
        return this.skip
      }
      if(node.type==='Url') {
        const value=node.value.startsWith('data:')?bounded(node.value):data(node.value,from)
        edits.push({start:node.loc.start.offset,end:node.loc.end.offset,value:`url("${value.replaceAll('"','%22')}")`})
      }
    })
    let offset=0;const output=[]
    for(const edit of edits.sort((a,b)=>a.start-b.start)) {
      output.push(bounded(source.slice(offset,edit.start)),bounded(edit.value));offset=edit.end
    }
    output.push(bounded(source.slice(offset)))
    // HTML raw-text elements do not escape text nodes. CSS escapes preserve the
    // literal character in strings but cannot terminate an injected <style>.
    return output.join('').replaceAll('<','\\3c ')
  }
  const raw=decode(file.data,POLICY.artifactBytes)
  const svgImage=bytes=>bounded('data:image/svg+xml;base64,'+Buffer.from(bytes).toString('base64'))
  if(file.path.endsWith('.svg')) {
    // Never serve SVG as a top-level active document: sandbox/CSP do NOT
    // confine its own link navigation. Image processing disables SVG links,
    // scripts and external resources, even for SMIL/foreignObject payloads.
    const body=Buffer.from(bounded('<!doctype html><meta charset="utf-8"><img alt="SVG preview" src="'+svgImage(raw)+'">'))
    return {body,type:'text/html; charset=utf-8'}
  }
  if(!file.path.endsWith('.html'))return {body:raw,type:mime(file.path)}
  // Enforce bounds DURING parsing: a post-parse walk is too late to prevent
  // htmlparser2's unmatched-close stack scans on deeply nested hostile input.
  class BoundedHandler extends DomHandler {
    depth=0
    onopentag(name,attrs) {
      tick()
      if(++this.depth>PRESENTATION_LIMITS.elementDepth)throw new Error('Preview depth limit')
      super.onopentag(name,attrs)
    }
    onclosetag() {tick();this.depth--;super.onclosetag()}
    ontext(data) {tick();super.ontext(data)}
    oncomment(data) {tick();super.oncomment(data)}
    onprocessinginstruction(name,data) {tick();super.onprocessinginstruction(name,data)}
  }
  const handler=new BoundedHandler()
  new Parser(handler).end(raw.toString('utf8'))
  const doc=handler.root
  const svgNS='http://www.w3.org/2000/svg',htmlNS='http://www.w3.org/1999/xhtml',mathNS='http://www.w3.org/1998/Math/MathML'
  const imageXML=(node,inherited=svgNS,depth=0,parentNS=svgNS)=>{
    tick()
    if(depth>PRESENTATION_LIMITS.elementDepth)throw new Error('Preview depth limit')
    if(!node.attribs)return DomUtils.getOuterHTML(node,{xmlMode:true})
    const name=node.name.toLowerCase()
    const ns=name==='svg'?svgNS:name==='math'?mathNS:node.attribs.xmlns??inherited
    const attrs={...node.attribs,...(ns!==parentNS?{xmlns:ns}:{})}
    // Serialize a detached shell: foreign mode restores SVG attribute/name
    // case, but must not switch descendants to HTML serialization at integration
    // points (HTML void tags, empty attributes and raw text are not XML-safe).
    const shell=DomUtils.getOuterHTML({...node,attribs:attrs,parent:null,children:[]},{xmlMode:ns===htmlNS?true:'foreign',selfClosingTags:false})
    const end=shell.indexOf('>')+1
    const childNS=ns===svgNS&&['foreignobject','desc','title'].includes(name)||ns===mathNS&&(['mi','mo','mn','ms','mtext'].includes(name)||name==='annotation-xml'&&/^(?:text\/html|application\/xhtml\+xml)$/i.test(attrs.encoding??''))?htmlNS:ns
    return shell.slice(0,end)+node.children.map(child=>imageXML(child,childNS,depth+1,ns)).join('')+shell.slice(end)
  }
  const visit=(nodes,depth=0)=>{
    if(depth>PRESENTATION_LIMITS.elementDepth)throw new Error('Preview depth limit')
    for(const node of [...nodes]) {
      tick()
      if(!node.attribs){if(node.children)visit(node.children,depth+1);continue}
      const attrs=node.attribs,name=node.name.toLowerCase()
      if(name==='svg') {
        // Snapshot the complete foreign subtree into image context, rather
        // than chasing every SVG URL mutation or XML namespace alias. Only
        // inert layout/accessibility attributes reach the parent HTML tree.
        attrs.xmlns='http://www.w3.org/2000/svg'
        attrs['xmlns:xlink']='http://www.w3.org/1999/xlink'
        const src=svgImage(imageXML(node))
        const layout=Object.fromEntries(['id','class','width','height','role','aria-label'].filter(key=>attrs[key]!==undefined).map(key=>[key,attrs[key]]))
        if(attrs.style)layout.style=css(attrs.style,file.path,[],'declarationList')
        node.name='img';node.type='tag';node.attribs={...layout,alt:attrs['aria-label']??'',src};node.children=[]
        continue
      }
      if(['base','iframe','object','embed'].includes(name) || name==='meta' && attrs['http-equiv']) {
        DomUtils.removeElement(node);continue
      }
      // CSP is the active-content boundary, not this presentation transform.
      // Remove navigation side channels as CSP doesn't forbid top-level links.
      for(const attr of Object.keys(attrs))if(attr.startsWith('on') || ['target','ping','action','formaction','srcdoc','manifest','background'].includes(attr))delete attrs[attr]
      if(name==='link') {
        if(attrs.rel?.toLowerCase()==='stylesheet') {
          const target=resolve(attrs.href,file.path)
          if(target?.file.path.endsWith('.css')) {
            node.name='style';node.attribs=attrs.media?{media:attrs.media}:{}
            node.children=[];DomUtils.appendChild(node,{type:'text',data:css(text(target.file),target.file.path),parent:null,prev:null,next:null})
          }else DomUtils.removeElement(node)
        }else if(attrs.rel?.toLowerCase()==='icon') {attrs.href=data(attrs.href,file.path)}
        else {DomUtils.removeElement(node);continue}
      }else {
        for(const attr of ['href','xlink:href'])if(attrs[attr]) {
          const target=resolve(attrs[attr],file.path)
          attrs[attr]=target?bounded(prefix+'/'+target.path+target.fragment):'#'
        }
        for(const attr of ['src','poster'])if(attrs[attr])attrs[attr]=data(attrs[attr],file.path)
        // Static local image candidates only; no heuristic parsing of data URLs.
        if(attrs.srcset)attrs.srcset=attrs.srcset.split(',').map(candidate=>{
          const [url,descriptor,...extra]=candidate.trim().split(/\s+/)
          if(extra.length || descriptor && !/^(?:\d+w|\d+(?:\.\d+)?x)$/.test(descriptor))return ''
          const value=data(url,file.path);return value?value+(descriptor?' '+descriptor:''):''
        }).filter(Boolean).join(', ')
      }
      if(attrs.style)attrs.style=css(attrs.style,file.path,[],'declarationList')
      if(name==='style')for(const child of node.children??[])if(child.type==='text')child.data=css(child.data,file.path)
      if(node.children)visit(node.children,depth+1)
    }
  }
  visit(doc.children)
  const body=Buffer.from(DomUtils.getOuterHTML(doc))
  if(body.length>POLICY.artifactBytes)throw new Error('Preview response limit')
  return {body,type:mime(file.path)}
}
