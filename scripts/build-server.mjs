import {build} from 'esbuild';
await build({entryPoints:{index:'server/index.ts','company-ops':'scripts/company-ops.ts'},outdir:'dist-server',outExtension:{'.js':'.mjs'},bundle:true,platform:'node',target:'node24',format:'esm',packages:'external',sourcemap:false});
