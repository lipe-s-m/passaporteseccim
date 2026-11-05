import { createHandler } from "./handler.mjs";
import { firebaseConfig } from "./firebase-config.mjs";

// A chave administrativa é fornecida pelo ambiente gerenciado do Supabase.
// Ela nunca é enviada ao navegador ou incluída nos arquivos de configuração.
Deno.serve(createHandler({
  ...firebaseConfig,
  supabaseUrl: Deno.env.get("SUPABASE_URL") ?? "",
  serviceKey: Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  // Chave do QR de presença (supabase secrets set QR_SECRET=...). Sem ela, as rotas do QR respondem 503.
  qrSecret: Deno.env.get("QR_SECRET") ?? ""
}));
