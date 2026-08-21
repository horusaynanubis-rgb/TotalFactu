"use strict";exports.id=5959,exports.ids=[5959],exports.modules={12441:(e,t,n)=>{function r(e){let t=e?`
ACCOUNT OWNER CONTEXT — use this to determine invoice roles:
  Legal name: ${e.name}
  Tax ID (CIF/NIF): ${e.tax_id}${e.aliases&&e.aliases.length>0?`
  Known aliases: ${e.aliases.join(", ")}`:""}

  - If the account owner appears as RECIPIENT/CUSTOMER → invoice_type = "received"
  - If the account owner appears as ISSUER/SUPPLIER → invoice_type = "issued"
  - Tax ID match takes priority over name match.
`:"";return`You are a document data extraction system. Extract structured data from this document.
Support multilingual documents (Spanish, English, French, German, Italian, Portuguese).
${t}
ROLE IDENTIFICATION RULES — apply these carefully before setting supplier_name and customer_name:

1. ISSUER/SUPPLIER (emisor/proveedor) is the company that:
   - Appears in the document HEADER with its logo, full address, phone, web, and fiscal registration data
   - Is listed near fields like "Raz\xf3n Social:", "Emisor:", "Proveedor:", "CIF/NIF:" in the header section
   - Is NOT inside any labeled block such as "Cliente:", "Centro:", "Destinatario:", "Facturar a:", "Enviar a:", "Direcci\xf3n de entrega"

2. RECIPIENT/CUSTOMER (receptor/cliente) is the company that:
   - Appears inside a block explicitly labeled: "Cliente:", "Centro:", "Destinatario:", "Facturar a:", "Enviar a:", "Direcci\xf3n de env\xedo"
   - Even if the same name appears elsewhere, a name INSIDE a "Cliente:" or "Centro:" block is ALWAYS the recipient

3. CRITICAL: A company name inside a "Cliente:", "Centro:", or "Destinatario:" block is NEVER the issuer/supplier, even if it appears multiple times elsewhere in the document.

4. If a company has a prominent header position with logo/web/phone/address, that company is the issuer regardless of other mentions.

5. supplier_name must be the ISSUER (header company). customer_name must be the RECIPIENT (Cliente/Centro block).

Rules:
- Do NOT hallucinate or invent values. If a field is not found, use null or empty string.
- Dates must be in YYYY-MM-DD format when possible. If only partial date is found, normalize it.
- All monetary amounts must be numbers (not strings).
- document_type: "invoice" if it is a tax invoice (factura), "delivery_note" if it is a delivery note / albaran / albar\xe1n / bon de livraison / Lieferschein (NOT a fiscal document), "cash_register" if it is a daily TPV/cash closure report (cierre de caja, cierre TPV, informe de lote, Z-report, X-report, batch report, liquidaci\xf3n del d\xeda, resumen de ventas del d\xeda), "unknown" if unclear.
- delivery_note_number: the delivery note number if document_type is "delivery_note", otherwise null.
- invoice_type: "received" if this is an invoice received from a supplier, "issued" if sent to a customer. Use "received" for delivery_note documents.
- extraction_confidence: a number between 0 and 1 indicating overall extraction quality.
- needs_review: true if confidence < 0.7 or if critical fields are missing.
- issuer_name: the exact company name found in the document header/logo area (emisor real del documento)
- issuer_tax_id: tax ID (CIF/NIF) of the issuer, or null
- recipient_name: the exact company name found inside a Cliente/Centro/Destinatario block (receptor real)
- recipient_tax_id: tax ID (CIF/NIF) of the recipient, or null
- role_reasoning_summary: one sentence explaining how you identified the issuer vs recipient

Respond with raw JSON only (no markdown, no code blocks). Use this exact structure:
{
  "document_type": "invoice" or "delivery_note" or "cash_register" or "unknown",
  "delivery_note_number": null,
  "invoice_type": "received" or "issued",
  "invoice_number": "string or empty",
  "issue_date": "YYYY-MM-DD or empty",
  "due_date": "YYYY-MM-DD or null",
  "supplier_name": "ISSUER company name (from header/logo area — NOT from Cliente block)",
  "supplier_tax_id": "string or null",
  "customer_name": "RECIPIENT company name (from Cliente/Centro/Destinatario block)",
  "customer_tax_id": "string or null",
  "subtotal": 0.00,
  "tax_amount": 0.00,
  "total_amount": 0.00,
  "currency": "EUR",
  "tax_rate": null,
  "payment_method": null,
  "category": null,
  "notes": null,
  "extraction_confidence": 0.95,
  "needs_review": false,
  "issuer_name": "company name found in document header/logo area",
  "issuer_tax_id": null,
  "recipient_name": "company name found in Cliente/Centro/Destinatario block",
  "recipient_tax_id": null,
  "role_reasoning_summary": "brief explanation of how issuer vs recipient was determined",
  "line_items": [
    {
      "description": "Product or service name as shown on the document",
      "quantity": 1.0,
      "unit_price": 9.99,
      "tax_rate": 21.0,
      "total_amount": 12.09
    }
  ]
}

Rules for line_items:
- Extract every line from the invoice (products, services, fees).
- If no individual lines are visible, return "line_items": [].
- Do NOT invent or estimate lines. Only include what is explicitly shown.
- quantity, unit_price, tax_rate, total_amount can be null if not visible for a line.
- description must be non-empty for each item.`}n.d(t,{Iu:()=>_,Lc:()=>g,T6:()=>c,l3:()=>l,oS:()=>u});let a=/[\s,]+(s\.?l\.?u?\.?|s\.?a\.?u?\.?|s\.?l\.?|ltd\.?|limited|inc\.?|llc\.?|gmbh|b\.?v\.?|n\.?v\.?|a\.?s\.?)\s*$/i;function i(e){return e?e.normalize("NFD").replace(/[̀-ͯ]/g,"").toLowerCase().replace(a,"").replace(/[.,]/g,"").replace(/\s+/g," ").trim():""}function o(e){return e?e.replace(/[\s.\-]/g,"").toUpperCase():""}function s(e,t,n){return!!(n.taxId&&t&&n.taxId===t||n.nameNorm&&function(e,t){if(!e||!t)return!1;if(e===t)return!0;let[n,r]=e.length<=t.length?[e,t]:[t,e];return n.length>=4&&r.includes(n)}(n.nameNorm,e)||n.aliasNorms.some(t=>t.length>=3&&!!e&&!!t&&!(t.length<3)&&e.includes(t)))}function l(e,t){let n={nameNorm:i(t.name),taxId:o(t.tax_id),aliasNorms:(t.aliases??[]).map(i)},r=i(e.supplier_name),a=i(e.customer_name),l=o(e.supplier_tax_id),c=o(e.customer_tax_id),u=s(r,l,n),d=s(a,c,n);if(l&&c&&l===c)return{isSuspicious:!0,reason:`supplier_tax_id equals customer_tax_id (${l}): same entity on both sides`,correctedSupplierName:null,correctedCustomerName:null,correctedSupplierTaxId:null,correctedCustomerTaxId:null,correctedInvoiceType:null};if(r&&a&&r===a)return{isSuspicious:!0,reason:`supplier_name equals customer_name: "${e.supplier_name}"`,correctedSupplierName:null,correctedCustomerName:null,correctedSupplierTaxId:null,correctedCustomerTaxId:null,correctedInvoiceType:null};if(u){let r=i(e.issuer_name),a=o(e.issuer_tax_id);if(!(!r||s(r,a,n))&&r.length>=3)return{isSuspicious:!0,reason:`supplier_name matches account owner but issuer_name="${e.issuer_name}" is different → likely received invoice`,correctedSupplierName:e.issuer_name,correctedCustomerName:e.recipient_name||e.customer_name||t.name,correctedSupplierTaxId:e.issuer_tax_id,correctedCustomerTaxId:e.recipient_tax_id||e.customer_tax_id,correctedInvoiceType:"received"};if(d){if(e.issuer_name&&e.recipient_name){let t=s(i(e.issuer_name),o(e.issuer_tax_id),n);return{isSuspicious:!0,reason:"Both supplier and customer match account owner. Using issuer/recipient fields for correction.",correctedSupplierName:e.issuer_name,correctedCustomerName:e.recipient_name,correctedSupplierTaxId:e.issuer_tax_id,correctedCustomerTaxId:e.recipient_tax_id,correctedInvoiceType:t?"issued":"received"}}return{isSuspicious:!0,reason:"Emisor y receptor ambiguos: ambos parecen ser la empresa propietaria",correctedSupplierName:null,correctedCustomerName:null,correctedSupplierTaxId:null,correctedCustomerTaxId:null,correctedInvoiceType:null}}}return{isSuspicious:!1,reason:null,correctedSupplierName:null,correctedCustomerName:null,correctedSupplierTaxId:null,correctedCustomerTaxId:null,correctedInvoiceType:null}}async function c(e,t,n){let r=process.env.GEMINI_API_KEY;if(!r)return null;let a=process.env.GEMINI_MODEL||"gemini-2.5-flash-preview-04-17",i=`https://generativelanguage.googleapis.com/v1beta/models/${a}:generateContent?key=${r}`,o=n?`Account owner: ${n.name} (${n.tax_id})${n.aliases?.length?`, aliases: ${n.aliases.join(", ")}`:""}. If account owner is RECIPIENT → invoice_type="received". If account owner is ISSUER → invoice_type="issued".`:"",s=`Look at this invoice document. Answer ONLY these role questions as JSON.

RULES:
- ISSUER = company in document header/logo area (their letterhead, address, phone, logo at top)
- RECIPIENT = company in a block labeled "Cliente:", "Centro:", "Destinatario:", "Facturar a:"
- A name INSIDE a "Cliente:" or "Centro:" labeled block is ALWAYS the recipient, never the issuer
${o?`- ${o}`:""}

Respond with raw JSON only (no markdown):
{
  "issuer_name": "exact company name from document header/logo (emisor)",
  "issuer_tax_id": "CIF/NIF of issuer or null",
  "recipient_name": "exact company name from Cliente/Centro block (receptor)",
  "recipient_tax_id": "CIF/NIF of recipient or null",
  "invoice_type": "received or issued",
  "reasoning": "one sentence"
}`;try{let n=await fetch(i,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{inlineData:{mimeType:t,data:e}},{text:s}]}],generationConfig:{responseMimeType:"application/json",maxOutputTokens:512}})});if(!n.ok)return console.warn(`[gemini:clarify] HTTP ${n.status} — skipping second pass`),null;let r=await n.json(),a=r?.candidates?.[0]?.content?.parts?.[0]?.text;if(!a)return null;let o=JSON.parse(a),l="issued"===o.invoice_type?"issued":"received";return{issuer_name:o.issuer_name??null,issuer_tax_id:o.issuer_tax_id??null,recipient_name:o.recipient_name??null,recipient_tax_id:o.recipient_tax_id??null,invoice_type:l,reasoning:o.reasoning??null}}catch(e){return console.error("[gemini:clarify] Second-pass role clarification failed:",e?.message),null}}async function u(e,t){let n=process.env.GEMINI_API_KEY;if(!n)return null;let r=process.env.GEMINI_MODEL||"gemini-2.5-flash-preview-04-17",a=`https://generativelanguage.googleapis.com/v1beta/models/${r}:generateContent?key=${n}`,i=`Mira esta factura. Extrae \xdaNICAMENTE el desglose de IVA: para cada tipo de IVA presente (0%, 4%, 10% o 21%), indica la base imponible y la cuota de IVA correspondientes a ese tipo.

NO extraigas proveedor, fecha, n\xfamero de factura, conceptos ni productos — solo el desglose fiscal.

Responde con JSON puro (sin markdown):
{
  "breakdown": [
    {"rate": 21, "base": 100.00, "iva": 21.00}
  ]
}

Si la factura tiene un \xfanico tipo de IVA, incluye solo una entrada. Si no puedes determinar el desglose de IVA con certeza, responde {"breakdown": []}.`;try{let n=await fetch(a,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({contents:[{parts:[{inlineData:{mimeType:t,data:e}},{text:i}]}],generationConfig:{responseMimeType:"application/json",maxOutputTokens:512,temperature:0}})});if(!n.ok)return console.warn(`[gemini:vat-breakdown] HTTP ${n.status} — treating as unresolved`),null;let r=await n.json(),o=r?.candidates?.[0]?.content?.parts?.[0]?.text;if(!o)return null;let s=JSON.parse(o);return{breakdown:(Array.isArray(s?.breakdown)?s.breakdown:[]).filter(e=>"number"==typeof e?.rate&&"number"==typeof e?.base&&"number"==typeof e?.iva).map(e=>({rate:e.rate,base:e.base,iva:e.iva}))}}catch(e){return console.error("[gemini:vat-breakdown] VAT-only second pass failed:",e?.message),null}}let d=[1e3,3e3];async function m(e,t,n){let a=process.env.GEMINI_API_KEY;if(!a)throw Error("GEMINI_API_KEY is not configured");let i=process.env.GEMINI_MODEL||"gemini-2.5-flash-preview-04-17",o=`https://generativelanguage.googleapis.com/v1beta/models/${i}:generateContent?key=${a}`,s=Math.round(3*e.length/4/1024);console.log(`[gemini:diag] provider=gemini model=${i} mimeType=${t} base64Length=${e.length} estimatedSizeKb=${s} maxOutputTokens=32000 hasCompanyCtx=${!!n}`);let l={contents:[{parts:[{inlineData:{mimeType:t,data:e}},{text:r(n)}]}],generationConfig:{responseMimeType:"application/json",maxOutputTokens:32e3}},c=Error("No attempts made");for(let e=1;e<=3;e++){let n;if(e>1){let t=d[e-2]??3e3;console.log(`[gemini:retry] attempt=${e}/3 waiting ${t}ms before retry`),await new Promise(e=>setTimeout(e,t))}let r=await fetch(o,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(l)});if(!r.ok){var u;let t=await r.text().catch(()=>r.statusText);console.error(`[gemini] HTTP ${r.status} attempt=${e}/3 error body (truncated):`,t.slice(0,500));let n=!!(429===(u=r.status)||503===u||t.includes("UNAVAILABLE")||t.includes("high demand")||t.includes("RESOURCE_EXHAUSTED"));if(c=Error(`Gemini API error (${r.status}): ${t.slice(0,300)}`),n&&e<3)continue;break}let a=await r.json(),s=a?.candidates?.[0]?.finishReason??"UNKNOWN",m=a?.usageMetadata??null;if(console.log(`[gemini:diag] candidates=${a?.candidates?.length} finishReason=${s} usage=${JSON.stringify(m)}`),"MAX_TOKENS"===s){let e=m?.promptTokenCount??"unknown",n=m?.candidatesTokenCount??"unknown";throw console.error(`[gemini:diag] ⚠️ finishReason=MAX_TOKENS — output truncated`,`model=${i}`,"maxOutputTokens=32000",`mimeType=${t}`,`inputTokens=${e}`,`outputTokens=${n}`),Error("Gemini:MAX_TOKENS: La factura tiene demasiadas l\xedneas para el l\xedmite actual de extracci\xf3n.")}if("SAFETY"===s)throw console.error("[gemini:diag] Response blocked by SAFETY filter"),Error("Gemini API error (SAFETY): response blocked by content safety filters");if("RECITATION"===s)throw console.error("[gemini:diag] Response blocked by RECITATION filter"),Error("Gemini API error (RECITATION): response blocked due to recitation");let _=a?.candidates?.[0]?.content?.parts?.[0]?.text;if(console.log(`[gemini:diag] response_first_500: ${String(_??"").slice(0,500)}`),!_)throw console.error("[gemini:diag] No content in response. finishReason:",s,"Full data:",JSON.stringify(a).slice(0,500)),Error(`No content in Gemini response (finishReason=${s})`);let f=_.includes("```");f&&console.warn("[gemini:diag] ⚠️ Response contains markdown fences — responseMimeType ignored by model");try{n=JSON.parse(_)}catch(e){throw console.error(`[gemini:diag] JSON parse FAILED finishReason=${s} hasMarkdown=${f} content_first_500: ${_.slice(0,500)}`),Error("Gemini response is not valid JSON")}return p(n)}throw c}function p(e){let t=(e,t="")=>null==e?t:String(e).trim(),n=(e,t=0)=>{if(null==e)return t;let n=Number(e);return isNaN(n)?t:n},r=e=>null==e||""===String(e).trim()?null:String(e).trim(),a=e=>{if(!e)return"";let t=String(e).trim();if(/^\d{4}-\d{2}-\d{2}$/.test(t))return t;let n=new Date(t);if(!isNaN(n.getTime())){let e=n.getFullYear(),t=String(n.getMonth()+1).padStart(2,"0"),r=String(n.getDate()).padStart(2,"0");return`${e}-${t}-${r}`}return""},i=t(e.document_type),o=["invoice","delivery_note","cash_register","unknown"].includes(i)?i:"invoice",s=["received","issued"].includes(t(e.invoice_type))?t(e.invoice_type):"received",l=(Array.isArray(e.line_items)?e.line_items:[]).filter(e=>e&&"string"==typeof e.description&&e.description.trim()).map(e=>({description:t(e.description),quantity:null!==e.quantity&&void 0!==e.quantity?n(e.quantity):null,unit_price:null!==e.unit_price&&void 0!==e.unit_price?n(e.unit_price):null,tax_rate:null!==e.tax_rate&&void 0!==e.tax_rate?n(e.tax_rate):null,total_amount:null!==e.total_amount&&void 0!==e.total_amount?n(e.total_amount):null})),c={document_type:o,delivery_note_number:r(e.delivery_note_number),invoice_type:s,invoice_number:t(e.invoice_number),issue_date:a(e.issue_date),due_date:e.due_date&&a(e.due_date)||null,supplier_name:t(e.supplier_name),supplier_tax_id:r(e.supplier_tax_id),customer_name:t(e.customer_name),customer_tax_id:r(e.customer_tax_id),subtotal:n(e.subtotal),tax_amount:n(e.tax_amount),total_amount:n(e.total_amount),currency:t(e.currency,"EUR").toUpperCase(),tax_rate:null!==e.tax_rate&&void 0!==e.tax_rate?n(e.tax_rate):null,payment_method:r(e.payment_method),category:r(e.category),notes:r(e.notes),extraction_confidence:Math.max(0,Math.min(1,n(e.extraction_confidence??e.confidence_score,.5))),needs_review:!1,line_items:l,issuer_name:r(e.issuer_name),issuer_tax_id:r(e.issuer_tax_id),recipient_name:r(e.recipient_name),recipient_tax_id:r(e.recipient_tax_id),role_reasoning_summary:r(e.role_reasoning_summary)};return c.needs_review=c.extraction_confidence<.7||!c.invoice_number||!c.issue_date||!c.supplier_name||!c.customer_name||c.total_amount<=0,c}async function _(e,t,n,a,i){let o;if("true"!==process.env.FORCE_LOCAL_AI&&"1"!==process.env.AI_FORCE_LOCAL&&(a?.provider==="gemini"||a?.provider!=="local"&&a?.provider!=="external"&&process.env.GEMINI_API_KEY))return m(e,t,i);let{apiUrl:s,apiKey:l,model:c}="true"===process.env.FORCE_LOCAL_AI||"1"===process.env.AI_FORCE_LOCAL?{apiUrl:(process.env.OLLAMA_BASE_URL||"http://10.6.0.5:11434/v1").replace(/\/$/,"")+"/chat/completions",apiKey:process.env.OLLAMA_API_KEY||"ollama",model:process.env.OLLAMA_MODEL||"qwen2.5:14b"}:a?.provider==="external"&&a.apiKey&&a.apiEndpoint?{apiUrl:a.apiEndpoint.replace(/\/$/,"")+"/chat/completions",apiKey:a.apiKey,model:process.env.EXTERNAL_AI_MODEL||"qwen2.5:14b"}:{apiUrl:(process.env.OLLAMA_BASE_URL||"http://10.6.0.5:11434/v1").replace(/\/$/,"")+"/chat/completions",apiKey:process.env.OLLAMA_API_KEY||"ollama",model:process.env.OLLAMA_MODEL||"qwen2.5:14b"};if(!l)throw Error("No AI API key configured");let u=[{type:"image_url",image_url:{url:`data:${t};base64,${e}`}},{type:"text",text:r(i)}],d=await fetch(s,{method:"POST",headers:{"Content-Type":"application/json",Authorization:`Bearer ${l}`},body:JSON.stringify({model:c,messages:[{role:"user",content:u}],response_format:{type:"json_object"},max_tokens:2e3})});if(!d.ok){let e=await d.text().catch(()=>d.statusText);throw console.error(`[ai] HTTP ${d.status} error body (truncated):`,e.slice(0,500)),Error(`AI API error (${d.status}): ${e.slice(0,300)}`)}let _=await d.json(),f=_?.choices?.[0]?.message?.content;if(!f)throw console.error("[ai] No content in response. Choices:",JSON.stringify(_?.choices).slice(0,300)),Error("No content in AI response");try{o=JSON.parse(f)}catch{throw console.error("[ai] Failed to parse JSON content (first 300 chars):",String(f).slice(0,300)),Error("AI response is not valid JSON")}return p(o)}let f=`You are analyzing a TPV/cash register daily closure report (cierre de caja, cierre TPV, Z-report, informe de lote, resumen ventas del d\xeda).

Extract the following data from this document. Many fields may be absent depending on the TPV model — only return fields explicitly shown.

Rules:
- date: closure date in YYYY-MM-DD format. Look for "FECHA:", "Date:", "Fecha cierre:", or any date near the totals.
- time: closure time as HH:MM or null if not shown.
- business_name: the name of the business/commerce shown on the receipt (raz\xf3n social, nombre comercio).
- terminal_id: TPV terminal identifier (N\xba terminal, Terminal ID, TID).
- batch_number: batch/lote number (Lote n\xba, Batch, N\xba lote).
- operation_count: total number of operations/transactions (N\xba operaciones, Transactions).
- cash_amount: total cash payments (Efectivo, Cash). Use 0 if not shown.
- card_amount: total card/TPV payments (Tarjeta, Card, TPV, Visa/MC total). Use 0 if not shown.
- bizum_amount: total Bizum payments. Use 0 if not shown.
- transfer_amount: total bank transfers. Use 0 if not shown.
- other_amount: any other payment method totals not covered above. Use 0 if not shown.
- total_amount: grand total of all collections for the day (Total, Gran Total, Total d\xeda). If not explicit, sum cash+card+bizum+transfer+other.
- notes: any relevant remarks (e.g. "Anulaciones: 3", "Lote forzado", etc.) or null.
- extraction_confidence: 0.0–1.0 confidence in the extraction quality.

Respond with raw JSON only (no markdown, no code blocks):
{
  "date": "YYYY-MM-DD",
  "time": "HH:MM or null",
  "business_name": "string or null",
  "terminal_id": "string or null",
  "batch_number": "string or null",
  "operation_count": null,
  "cash_amount": 0.00,
  "card_amount": 0.00,
  "bizum_amount": 0.00,
  "transfer_amount": 0.00,
  "other_amount": 0.00,
  "total_amount": 0.00,
  "notes": null,
  "extraction_confidence": 0.85
}`;async function g(e,t){let n=process.env.GEMINI_API_KEY;if(!n)return console.warn("[gemini:cash_register] GEMINI_API_KEY not configured — skipping specialized extraction"),null;let r=process.env.GEMINI_MODEL||"gemini-2.5-flash-preview-04-17",a=`https://generativelanguage.googleapis.com/v1beta/models/${r}:generateContent?key=${n}`,i={contents:[{parts:[{inlineData:{mimeType:t,data:e}},{text:f}]}],generationConfig:{responseMimeType:"application/json",maxOutputTokens:1024}};for(let e=1;e<=3;e++){e>1&&await new Promise(t=>setTimeout(t,2===e?1e3:3e3));try{let t=await fetch(a,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(i)});if(!t.ok){let n=await t.text().catch(()=>"");if((429===t.status||503===t.status)&&e<3)continue;return console.error(`[gemini:cash_register] HTTP ${t.status} attempt=${e}:`,n.slice(0,300)),null}let n=await t.json(),r=n?.candidates?.[0]?.content?.parts?.[0]?.text;if(!r)return null;let o=JSON.parse(r),s=e=>{let t=Number(e);return isNaN(t)?0:Math.max(0,t)},l=e=>null!=e&&String(e).trim()?String(e).trim():null,c=s(o.cash_amount),u=s(o.card_amount),d=s(o.bizum_amount),m=s(o.transfer_amount),p=s(o.other_amount),_=o.total_amount?s(o.total_amount):c+u+d+m+p,f="";if(o.date){let e=new Date(String(o.date).trim());isNaN(e.getTime())?/^\d{4}-\d{2}-\d{2}$/.test(String(o.date).trim())&&(f=String(o.date).trim()):f=e.toISOString().split("T")[0]}f||(f=new Date().toISOString().split("T")[0]);let g=Math.max(0,Math.min(1,s(o.extraction_confidence||.7)));return console.log(`[gemini:cash_register] ✅ extracted date=${f} total=${_} confidence=${g}`),{date:f,time:l(o.time),business_name:l(o.business_name),terminal_id:l(o.terminal_id),batch_number:l(o.batch_number),operation_count:null!=o.operation_count?Math.round(s(o.operation_count)):null,cash_amount:c,card_amount:u,bizum_amount:d,transfer_amount:m,other_amount:p,total_amount:_,notes:l(o.notes),extraction_confidence:g}}catch(t){if(console.error(`[gemini:cash_register] attempt=${e} error:`,t?.message),3===e)break}}return null}},59061:(e,t,n)=>{n.d(t,{N:()=>a});var r=n(95908);async function a(e,t="document-file"){let n=await (0,r.qm)(e.cloud_storage_path,e.is_public),a=await fetch(n);if(!a.ok)throw Error(`Error guardando archivo — storage fetch failed (${a.status} ${a.statusText})`);let i=await a.arrayBuffer(),o=Buffer.from(i).toString("base64"),s=Math.round(i.byteLength/1024),l=Buffer.from(i).slice(0,5).toString("hex"),c=l.startsWith("255044462d")?"application/pdf":l.startsWith("89504e47")?"image/png":l.startsWith("ffd8ff")?"image/jpeg":"unknown",u="application/octet-stream"===e.mime_type&&"unknown"!==c?c:e.mime_type;return console.log(`[${t}] sizeKb=${s} stored_mime=${e.mime_type} detected_mime=${c} effective_mime=${u}`),{fileBase64:o,effectiveMime:u,sizeKb:s}}},42723:(e,t,n)=>{n.d(t,{U:()=>r});function r(e,t){return"unclassified"!==e.source?{fiscal_status:"classified",fiscal_status_reason:e.source}:t?.secondPassAttempted?{fiscal_status:"manual_review",fiscal_status_reason:"multi-rate-unreconciled"===e.unclassifiedReason?"ai-unresolved-multi-rate":"ai-unresolved-no-data"}:"multi-rate-unreconciled"===e.unclassifiedReason?{fiscal_status:"mixed_vat",fiscal_status_reason:"multi-rate-unreconciled"}:{fiscal_status:"pending_classification",fiscal_status_reason:"no-data"}}},19547:(e,t,n)=>{n.d(t,{Z:()=>l,p:()=>s});let r=[0,4,10,21];function a(e){return null==e?e:0!==e&&1>Math.abs(e)?100*e:e}function i(e,t){let n=new Map;for(let r of e){if(null===r.tax_rate||void 0===r.tax_rate||null===r.total_amount||void 0===r.total_amount)continue;let e=r.tax_rate,a=t?r.total_amount:r.total_amount/(1+e/100),i=e/100*a,o=n.get(e)??{rate:e,base:0,iva:0};o.base+=a,o.iva+=i,n.set(e,o)}return Array.from(n.values()).sort((e,t)=>e.rate-t.rate)}function o(e,t,n){let r=e.reduce((e,t)=>e+t.base,0),a=e.reduce((e,t)=>e+t.iva,0);return .15>=Math.abs(r-t)&&.15>=Math.abs(a-n)}function s(e,t,n,s,l){if(l&&l.length>0)return 1===l.length?{rate:l[0].rate,source:"ai-vat"}:{rate:null,source:"ai-vat",breakdown:l};e=a(e);let c=Array.from(new Set((t=t.map(e=>({...e,tax_rate:a(e.tax_rate)}))).map(e=>e.tax_rate).filter(e=>null!=e)));if(c.length>=2){let e=i(t,!0);if(o(e,n,s))return{rate:null,source:"lines-split",breakdown:e};let r=i(t,!1);return o(r,n,s)?{rate:null,source:"lines-split",breakdown:r}:{rate:null,source:"unclassified",unclassifiedReason:"multi-rate-unreconciled"}}if(1===c.length)return{rate:c[0],source:"lines"};if(null!=e)return{rate:e,source:"header"};if(0!==n){let e=s/n*100,t=r[0],a=Math.abs(e-t);for(let n of r.slice(1)){let r=Math.abs(e-n);r<a&&(t=n,a=r)}if(a<=.6)return{rate:t,source:"calc"}}return{rate:null,source:"unclassified",unclassifiedReason:"no-data"}}function l(e){switch(e.source){case"header":return"";case"ai-vat":return e.breakdown?"Desglose de IVA obtenido mediante verificaci\xf3n adicional con IA (varios tipos)":"Tipo de IVA obtenido mediante verificaci\xf3n adicional con IA";case"lines":return"Tipo de IVA inferido desde las l\xedneas de factura (cabecera sin tipo)";case"calc":return"Tipo de IVA calculado a partir de base imponible y cuota (cabecera y l\xedneas sin tipo) — revisar si es posible";case"lines-split":return"Factura con varias l\xedneas a distintos tipos de IVA — repartida autom\xe1ticamente por tipo (ver detalle por l\xednea)";case"unclassified":return"multi-rate-unreconciled"===e.unclassifiedReason?"L\xedneas con varios tipos de IVA pero los importes no cuadran con la cabecera — revisar factura manualmente":"Sin tipo de IVA en cabecera y sin l\xedneas de detalle — revisar factura"}}},72331:(e,t,n)=>{n.d(t,{_:()=>a});var r=n(53524);let a=global.prisma||new r.PrismaClient},95908:(e,t,n)=>{n.d(t,{B6:()=>c,Fu:()=>u,Hz:()=>s,_I:()=>f,aR:()=>g,ar:()=>m,cT:()=>d,qm:()=>_,vw:()=>p,y5:()=>l});var r=n(3370);function a(e){let t=e.normalize("NFD").replace(/[̀-ͯ]/g,""),n=t.lastIndexOf("."),r=n>0?t.slice(0,n):t,a=n>0?t.slice(n).toLowerCase():"",i=r.lastIndexOf(".");if(i>0){let e=r.slice(i).toLowerCase();/^\.(pdf|jpg|jpeg|png|webp|gif|tiff?)$/.test(e)&&(r=r.slice(0,i))}return(r.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-+|-+$/g,"")||"document")+a}function i(){let e=process.env.SUPABASE_URL,t=process.env.SUPABASE_SERVICE_ROLE_KEY;if(!e)throw Error("SUPABASE_URL is not set");if(!t)throw Error("SUPABASE_SERVICE_ROLE_KEY is not set");return(0,r.eI)(e,t,{auth:{persistSession:!1}})}function o(){return process.env.SUPABASE_STORAGE_BUCKET||"invoices"}function s(e,t){return`uploads/${e}/${Date.now()}-${a(t)}`}function l(e,t){return`uploads/telegram/${e}/${Date.now()}-${a(t)}`}function c(e,t){return`exports/${e}/${Date.now()}-${a(t)}`}function u(e,t,n,r){return`fiscal-documents/${e}/${t}/${n}/${Date.now()}-${a(r)}`}async function d(e,t,n){let{error:r}=await i().storage.from(o()).upload(t,e,{contentType:n,upsert:!1});if(r)throw Error(`[storage] Upload failed (${t}): ${r.message}`)}async function m(e){let{data:t,error:n}=await i().storage.from(o()).createSignedUploadUrl(e);if(n||!t?.signedUrl)throw Error(`[storage] createSignedUploadUrl failed (${e}): ${n?.message}`);return{uploadUrl:t.signedUrl,cloud_storage_path:e}}async function p(e,t=3600){let{data:n,error:r}=await i().storage.from(o()).createSignedUrl(e,t);if(r||!n?.signedUrl)throw Error(`[storage] createSignedUrl failed (${e}): ${r?.message}`);return n.signedUrl}async function _(e,t=!1){return p(e)}async function f(e){let{error:t}=await i().storage.from(o()).remove([e]);if(t)throw Error(`[storage] Delete failed (${e}): ${t.message}`)}async function g(){let e=o(),t=`__probe__/${Date.now()}.txt`;try{let n=i(),{error:r}=await n.storage.from(e).upload(t,Buffer.from("ok"),{contentType:"text/plain",upsert:!0});if(r)return{ok:!1,bucket:e,error:`upload: ${r.message}`};let{data:a,error:o}=await n.storage.from(e).createSignedUrl(t,60),s=!o&&!!a?.signedUrl;return await n.storage.from(e).remove([t]),{ok:!0,bucket:e,signed_url_ok:s}}catch(t){return{ok:!1,bucket:e,error:t?.message??"unknown error"}}}}};