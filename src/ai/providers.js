// 班主任工作台 · Developed by @赛博老爸 · 非商业许可，见 LICENSE
import { S } from '../core/state.js';

/* =========================================================
   AI 助手 · 多家接口、流式输出、模板、隐私脱敏、批量评语、无 API 复制提示词
   ========================================================= */
var AI_PRESETS = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    base: 'https://api.deepseek.com',
    model: 'deepseek-flash',
    site: 'platform.deepseek.com',
    hint: '需要更强的推理可以把模型改成 deepseek-v4-pro'
  },
  {
    id: 'qwen',
    name: '通义千问（阿里云百炼）',
    base: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen-plus',
    site: 'bailian.console.aliyun.com'
  },
  {
    id: 'kimi',
    name: 'Kimi（月之暗面）',
    base: 'https://api.moonshot.cn/v1',
    model: 'kimi-k3',
    site: 'platform.moonshot.cn'
  },
  {
    id: 'glm',
    name: '智谱 GLM',
    base: 'https://open.bigmodel.cn/api/paas/v4',
    model: 'glm-4-flash',
    site: 'open.bigmodel.cn',
    hint: 'glm-4-flash 是免费模型，也可以换成控制台里的其他模型'
  },
  {
    id: 'doubao',
    name: '豆包（火山方舟）',
    base: 'https://ark.cn-beijing.volces.com/api/v3',
    model: '',
    site: 'console.volcengine.com/ark',
    hint: '模型名填方舟控制台里的模型 ID 或推理接入点 ID'
  },
  {
    id: 'silicon',
    name: '硅基流动',
    base: 'https://api.siliconflow.cn/v1',
    model: 'deepseek-ai/DeepSeek-V3',
    site: 'cloud.siliconflow.cn'
  },
  {
    id: 'openai',
    name: 'OpenAI',
    base: 'https://api.openai.com/v1',
    model: 'gpt-4o-mini',
    site: 'platform.openai.com'
  },
  {
    id: 'claude',
    name: 'Claude（Anthropic）',
    base: 'https://api.anthropic.com/v1',
    model: 'claude-sonnet-5-5',
    site: 'console.anthropic.com'
  },
  {
    id: 'ollama',
    name: 'Ollama 本地模型',
    base: 'http://localhost:11434/v1',
    model: 'qwen2.5:7b',
    site: 'ollama.com',
    hint: '本地运行无需 Key；需设置环境变量 OLLAMA_ORIGINS=* 允许网页访问'
  },
  {
    id: 'custom',
    name: '自定义（OpenAI 兼容接口）',
    base: '',
    model: '',
    site: '',
    hint: '任何兼容 /chat/completions 的服务都可以，比如 one-api、new-api 中转'
  }
];

function presetOf(id) {
  for (var i = 0; i < AI_PRESETS.length; i++) if (AI_PRESETS[i].id === id) return AI_PRESETS[i];
  return AI_PRESETS[AI_PRESETS.length - 1];
}

function tempOf(a) {
  var t = parseFloat(a.temp);
  return isNaN(t) ? 0.7 : Math.max(0, Math.min(1.5, t));
}

var AIC = {
  ready: function () {
    var a = S.settings.ai;
    return !!(a.base && a.model && (a.key || /localhost|127\.0\.0\.1/.test(a.base)));
  },
  isClaude: function () {
    var a = S.settings.ai;
    return a.provider === 'claude' || /anthropic\.com/.test(a.base);
  },
  label: function () {
    var a = S.settings.ai;
    return presetOf(a.provider).name.replace(/（.*）/, '') + ' · ' + (a.model || '未填模型');
  },
  stream: function (messages, onDelta, signal, maxTokens) {
    var a = S.settings.ai,
      base = String(a.base || '').replace(/\/+$/, '');
    var req, url;
    if (AIC.isClaude()) {
      var sys = messages
        .filter(function (m) {
          return m.role === 'system';
        })
        .map(function (m) {
          return m.content;
        })
        .join('\n\n');
      url = base + '/messages';
      req = {
        method: 'POST',
        signal: signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': a.key,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: a.model,
          max_tokens: maxTokens || 4096,
          system: sys,
          stream: true,
          temperature: Math.min(1, tempOf(a)),
          messages: messages.filter(function (m) {
            return m.role !== 'system';
          })
        })
      };
    } else {
      url = base + '/chat/completions';
      var hd = { 'Content-Type': 'application/json' };
      if (a.key) hd.Authorization = 'Bearer ' + a.key;
      var body = { model: a.model, messages: messages, stream: true, temperature: tempOf(a) };
      if (maxTokens) body.max_tokens = maxTokens;
      req = { method: 'POST', signal: signal, headers: hd, body: JSON.stringify(body) };
    }
    var full = '';
    function push(t) {
      if (t) {
        full += t;
        onDelta(t, full);
      }
    }
    return fetch(url, req)
      .then(function (res) {
        if (!res.ok)
          return res.text().then(function (t) {
            throw AIC.httpErr(res.status, t);
          });
        var ct = res.headers.get('content-type') || '';
        if (ct.indexOf('application/json') >= 0) {
          return res.json().then(function (j) {
            var t =
              j.choices && j.choices[0] && j.choices[0].message
                ? j.choices[0].message.content
                : j.content && j.content[0]
                  ? j.content[0].text
                  : '';
            push(t || '');
            return full;
          });
        }
        var reader = res.body.getReader(),
          dec = new TextDecoder('utf-8'),
          buf = '';
        function pump() {
          return reader.read().then(function (r) {
            if (r.done) return full;
            buf += dec.decode(r.value, { stream: true });
            var lines = buf.split('\n');
            buf = lines.pop();
            lines.forEach(function (ln) {
              ln = ln.trim();
              if (ln.indexOf('data:') !== 0) return;
              var p = ln.slice(5).trim();
              if (!p || p === '[DONE]') return;
              try {
                var j = JSON.parse(p);
                if (j.error) throw AIC.httpErr(400, JSON.stringify(j.error));
                if (j.type === 'content_block_delta' && j.delta) push(j.delta.text || '');
                else if (j.choices && j.choices[0] && j.choices[0].delta)
                  push(j.choices[0].delta.content || '');
              } catch (e) {
                if (e && e.isAI) throw e;
              }
            });
            return pump();
          });
        }
        return pump();
      })
      .catch(function (e) {
        if (e && e.isAI) throw e;
        if (e && e.name === 'AbortError') {
          var ab = new Error('已停止生成');
          ab.isAI = true;
          ab.abort = true;
          throw ab;
        }
        var ne = new Error(
          '连不上 AI 服务。常见原因：① 网络不通或地址填错；② 这家服务不允许网页直接调用（跨域限制）。可以换 DeepSeek、Kimi 等试试，或运行开源包里的 ai-proxy.js 做本地中转。'
        );
        ne.isAI = true;
        throw ne;
      });
  },
  httpErr: function (status, text) {
    var msg = '',
      detail = '';
    try {
      var j = JSON.parse(text);
      detail = (j.error && (j.error.message || j.error.msg)) || j.message || '';
    } catch (e) {
      detail = String(text || '').slice(0, 160);
    }
    if (status === 401 || status === 403)
      msg = 'API Key 无效或没有权限，请到「设置 → AI 接口」检查。';
    else if (status === 404) msg = '接口地址或模型名不对，请检查 Base URL 和模型名称。';
    else if (status === 429) msg = '请求太频繁或额度用完了，稍后再试，或到服务商后台看看余额。';
    else if (status === 402) msg = '账户余额不足，请到服务商后台充值。';
    else if (status >= 500) msg = 'AI 服务暂时出错（' + status + '），稍后再试。';
    else msg = '请求被拒绝（' + status + '）。';
    var e = new Error(msg + (detail ? '\n服务返回：' + detail : ''));
    e.isAI = true;
    e.status = status;
    return e;
  }
};

export { AIC, AI_PRESETS, presetOf };
