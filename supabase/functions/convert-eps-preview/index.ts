import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

interface RequestBody {
  epsBase64: string;
  cloudConvertApiKeys: string[];
}

function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function tryKey(apiKey: string, epsBytes: Uint8Array): Promise<string | null> {
  const auth = { Authorization: `Bearer ${apiKey}` };
  console.log('[CloudConvert] creating job');

  // 1. Create job with import/upload -> convert -> export/url
  const jobRes = await fetch('https://api.cloudconvert.com/v2/jobs', {
    method: 'POST',
    headers: { ...auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tasks: {
        'import-eps': { operation: 'import/upload' },
        'convert-eps': {
          operation: 'convert',
          input: 'import-eps',
          input_format: 'eps',
          output_format: 'png',
          pixel_density: 150,
          alpha: false,
        },
        'export-png': { operation: 'export/url', input: 'convert-eps' },
      },
    }),
  });

  if (!jobRes.ok) {
    console.warn('[CloudConvert] job creation failed', jobRes.status, await jobRes.text().catch(() => ''));
    return null;
  }

  const jobJson = await jobRes.json();
  const jobId = jobJson?.data?.id as string | undefined;
  const importTask = jobJson?.data?.tasks?.find((t: { name: string }) => t.name === 'import-eps');
  if (!jobId || !importTask?.result?.form) {
    console.warn('[CloudConvert] missing job id or import form');
    return null;
  }

  // 2. Upload EPS bytes to import task
  const form = importTask.result.form as { url: string; parameters: Record<string, string> };
  const fd = new FormData();
  for (const [k, v] of Object.entries(form.parameters)) fd.append(k, v);
  fd.append('file', new Blob([epsBytes as BlobPart], { type: 'application/postscript' }), 'input.eps');

  const uploadRes = await fetch(form.url, { method: 'POST', body: fd });
  if (!uploadRes.ok && uploadRes.status !== 201 && uploadRes.status !== 204) {
    console.warn('[CloudConvert] upload failed', uploadRes.status);
    return null;
  }

  // 3. Poll job status
  const deadline = Date.now() + 40_000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const statusRes = await fetch(`https://api.cloudconvert.com/v2/jobs/${jobId}`, { headers: auth });
    if (!statusRes.ok) {
      console.warn('[CloudConvert] poll failed', statusRes.status);
      continue;
    }
    const statusJson = await statusRes.json();
    const status = statusJson?.data?.status;
    console.log('[CloudConvert] job status', status);
    if (status === 'finished') {
      const exportTask = statusJson.data.tasks.find((t: { name: string }) => t.name === 'export-png');
      const fileUrl = exportTask?.result?.files?.[0]?.url as string | undefined;
      if (!fileUrl) {
        console.warn('[CloudConvert] no exported file url');
        return null;
      }
      const fileRes = await fetch(fileUrl);
      if (!fileRes.ok) {
        console.warn('[CloudConvert] file download failed', fileRes.status);
        return null;
      }
      const buf = new Uint8Array(await fileRes.arrayBuffer());
      let bin = '';
      for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]);
      const b64 = btoa(bin);
      return `data:image/png;base64,${b64}`;
    }
    if (status === 'error') {
      console.warn('[CloudConvert] job errored', JSON.stringify(statusJson).slice(0, 500));
      return null;
    }
  }
  console.warn('[CloudConvert] timed out after 40s');
  return null;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const body = (await req.json()) as RequestBody;
    const keys = Array.isArray(body.cloudConvertApiKeys) ? body.cloudConvertApiKeys.filter(Boolean) : [];
    console.log('[CloudConvert] request received, keys=', keys.length);

    if (!body.epsBase64 || keys.length === 0) {
      return new Response(JSON.stringify({ error: 'cloudconvert_unavailable' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const epsBytes = base64ToUint8Array(body.epsBase64);

    for (let i = 0; i < keys.length; i++) {
      console.log(`[CloudConvert] trying key ${i + 1}/${keys.length}`);
      try {
        const result = await tryKey(keys[i], epsBytes);
        if (result) {
          return new Response(JSON.stringify({ previewDataUrl: result }), {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
      } catch (err) {
        console.warn(`[CloudConvert] key ${i + 1} threw`, err);
      }
    }

    return new Response(JSON.stringify({ error: 'cloudconvert_unavailable' }), {
      status: 502,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[CloudConvert] unhandled error', err);
    return new Response(JSON.stringify({ error: 'cloudconvert_unavailable' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
