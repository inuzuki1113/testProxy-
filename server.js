import express from 'express';
import fetch from 'node-fetch';
import { JSDOM } from 'jsdom';
import cookieParser from 'cookie-parser';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cookieParser());
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- ユーザー単位・ドメイン単位の Cookie 管理 ---
const sessionStore = {}; // { sessionID: { domain: cookieString } }

// 簡易的にセッションIDはIPで代用（Renderではリバースプロキシの可能性あり）
function getSessionID(req) {
  return req.ip || 'default';
}

// ホーム
app.get('/', (req,res)=>{
  res.sendFile(path.join(__dirname,'public','index.html'));
});

// プロキシ
app.all('/proxy', async (req,res)=>{
  const targetUrl = req.query.url || req.body.url;
  if(!targetUrl) return res.status(400).send('URLを指定してください');

  const sessionID = getSessionID(req);
  const domain = new URL(targetUrl).hostname;
  sessionStore[sessionID] = sessionStore[sessionID] || {};
  const cookieHeader = sessionStore[sessionID][domain] || '';

  try{
    const response = await fetch(targetUrl,{
      method: req.method,
      headers: {
        ...req.headers,
        cookie: cookieHeader,
        host: domain
      },
      redirect:'manual',
      body: ['POST','PUT'].includes(req.method) ? req.body : undefined
    });

    // Cookie保存
    const setCookie = response.headers.raw()['set-cookie'];
    if(setCookie){
      sessionStore[sessionID][domain] = setCookie.map(c=>c.split(';')[0]).join('; ');
    }

    const contentType = response.headers.get('content-type') || '';

    // HTML/JSONは DOM 書き換えのみ
    if(contentType.includes('text/html') || contentType.includes('application/json')){
      let text = await response.text();
      const dom = new JSDOM(text);
      const document = dom.window.document;

      // aタグリンク書き換え
      document.querySelectorAll('a').forEach(a=>{
        if(a.href.startsWith('http')) a.href=`/proxy?url=${encodeURIComponent(a.href)}`;
      });

      // formタグ
      document.querySelectorAll('form').forEach(f=>f.action='/proxy');

      // scriptタグは書き換えず中継のみ
      document.querySelectorAll('link[rel="stylesheet"]').forEach(l=>{
        if(l.href && l.href.startsWith('http')) l.href=`/proxy?url=${encodeURIComponent(l.href)}`;
      });

      res.send(dom.serialize());

    }else{
      // --- 大容量ファイルはストリーミング ---
      res.setHeader('content-type', contentType);
      const range = req.headers.range;
      if(range){
        // Rangeヘッダはそのまま転送（Render対応）
        const upstreamHeaders = {};
        if(range) upstreamHeaders['range'] = range;

        const upstreamResponse = await fetch(targetUrl, {
          headers: upstreamHeaders,
          method: req.method,
          body: ['POST','PUT'].includes(req.method)? req.body : undefined
        });

        res.status(upstreamResponse.status);
        upstreamResponse.body.pipe(res);

      }else{
        response.body.pipe(res);
      }
    }

  }catch(err){
    res.status(500).send('エラー: '+err.message);
  }
});

const PORT = process.env.PORT || 10000;
app.listen(PORT,()=>console.log(`Render対応プロキシ起動: http://localhost:${PORT}`));
