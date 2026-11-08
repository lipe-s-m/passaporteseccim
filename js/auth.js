// Login, cadastro, verificação de e-mail e sessão (Firebase Auth via REST).
function setAuthBusy(busy) {
  state.busy = busy;
  for (const id of ["authSubmit", "resetPassword", "loginMode", "signupMode", "resendVerification", "checkVerification"]) {
    $(id).disabled = busy || !firebaseConfigured() || !state.publicReady;
  }
}

function setAuthMode(mode) {
  state.mode = mode;
  const signup = mode === "signup";
  $("nameField").hidden = !signup;
  $("fullName").required = signup;
  $("password").minLength = signup ? 8 : 1;
  $("password").pattern = signup ? "(?=.*[A-Za-z])(?=.*[0-9]).{8,128}" : ".*";
  $("password").title = signup ? "Use pelo menos 8 caracteres, com uma letra e um número." : "";
  $("password").autocomplete = signup ? "new-password" : "current-password";
  $("password").value = "";
  $("authSubmit").textContent = signup ? text("signup_label", "Criar conta") : text("login_label", "Entrar");
  $("loginMode").hidden = !signup;
  $("signupMode").hidden = signup;
  $("resetPassword").hidden = signup;
  setAuthBusy(state.busy);
}

function showVerification() {
  clearPassport();
  $("authForm").hidden = true;
  $("authModes").hidden = true;
  $("verificationPanel").hidden = false;
  $("logoutButton").hidden = false;
  message("pageMessage", "");
  message("authMessage", text("verification_description", "Confirme seu e-mail pelo link recebido e atualize a confirmação."));
}

async function accessToken() {
  if (!state.session) throw new Error("Sessão ausente.");
  if (state.session.expiresAt < Date.now() + 30000) {
    const generation = state.generation;
    let data;
    try {
      data = await firebaseRequest("", { grant_type: "refresh_token", refresh_token: state.session.refreshToken }, true);
    } catch (error) {
      if (generation === state.generation && ["INVALID_REFRESH_TOKEN","TOKEN_EXPIRED","USER_DISABLED","USER_NOT_FOUND","INVALID_ID_TOKEN"].includes(error.code)) {
        forgetSession(); error.status = 401;
      }
      throw error;
    }
    if (generation !== state.generation) throw new Error("Sessão encerrada.");
    saveSession({ idToken: data.id_token, refreshToken: data.refresh_token, expiresIn: data.expires_in });
  }
  return state.session.idToken;
}

function saveSession(data) {
  const seconds = Number(data?.expiresIn);
  if (!data?.idToken || !data?.refreshToken || !Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("Resposta de autenticação inválida.");
  }
  // Persistência limitada à aba, para navegar entre passaporte e palestra.
  state.session = { idToken: data.idToken, refreshToken: data.refreshToken, expiresAt: Date.now() + seconds * 1000 };
  try { sessionStorage.setItem("seccim.auth.session", JSON.stringify(state.session)); } catch {}
}

function forgetSession() {
  state.session = null;
  try { sessionStorage.removeItem("seccim.auth.session"); } catch {}
}

function restoreSession() {
  try {
    const saved = JSON.parse(sessionStorage.getItem("seccim.auth.session"));
    if (!saved || typeof saved.idToken !== "string" || !saved.idToken || saved.idToken.length > 8192 ||
      typeof saved.refreshToken !== "string" || !saved.refreshToken || saved.refreshToken.length > 8192 ||
      !Number.isFinite(saved.expiresAt) || saved.expiresAt <= 0) { forgetSession(); return; }
    state.session = { idToken:saved.idToken, refreshToken:saved.refreshToken, expiresAt:saved.expiresAt };
  } catch { forgetSession(); }
}

async function sendVerificationEmail() {
  const token = await accessToken();
  await firebaseRequest("accounts:sendOobCode", { requestType: "VERIFY_EMAIL", idToken: token });
}

$("loginMode").addEventListener("click", () => { setAuthMode("login"); message("authMessage", ""); });
$("signupMode").addEventListener("click", () => { setAuthMode("signup"); message("authMessage", ""); });
$("authForm").addEventListener("submit", async event => {
  event.preventDefault();
  if (state.busy || !firebaseConfigured() || !state.publicReady) return;
  const mode = state.mode;
  const email = $("email").value.trim().toLowerCase();
  const name = $("fullName").value.trim();
  const password = $("password").value;
  // A validação HTML ajuda a pessoa; a política de senha também deve ser
  // configurada no Firebase, onde é aplicada mesmo sem passar pela interface.
  if (mode === "signup" && (name.length < 1 || password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password))) {
    message("authMessage", "Informe seu nome e uma senha de pelo menos 8 caracteres, com uma letra e um número.", true);
    return;
  }
  $("password").value = "";
  const generation = ++state.generation;
  setAuthBusy(true);
  let created = false;
  let signupStage = "profile";
  try {
    const data = await firebaseRequest(mode === "signup" ? "accounts:signUp" : "accounts:signInWithPassword", {
      email, password, returnSecureToken: true
    });
    if (generation !== state.generation) return;
    saveSession(data);
    if (mode === "signup") {
      created = true;
      showVerification();
      const updated = await firebaseRequest("accounts:update", { idToken: state.session.idToken, displayName: name, returnSecureToken: true });
      if (generation !== state.generation) return;
      // Atualizar somente o nome pode responder 200 sem renovar os tokens.
      // Nesse caso, a sessão obtida no cadastro continua válida.
      if (updated?.idToken && updated.refreshToken && Number(updated.expiresIn) > 0) saveSession(updated);
      signupStage = "verification";
      await sendVerificationEmail();
      if (generation !== state.generation) return;
      message("authMessage", text("verification_sent", "Enviamos o link de confirmação para seu e-mail. Confira também o spam."));
    } else await loadPassport();
  } catch (error) {
    if (generation !== state.generation) return;
    if (created) {
      showVerification();
      message("authMessage", signupStage === "profile"
        ? "Sua conta foi criada, mas não conseguimos salvar seu nome. Entre novamente para continuar."
        : "Conta criada. Não foi possível enviar a confirmação. Tente reenviar ou entre novamente.", true);
    } else {
      forgetSession();
      clearPassport();
      message("authMessage", mode === "signup"
        ? text("signup_error", "Não foi possível concluir o cadastro. Se já possui conta, entre ou recupere a senha.")
        : text("auth_error", "Não foi possível entrar. Confira os dados ou use a recuperação de senha."), true);
    }
  } finally { setAuthBusy(false); }
});

$("resendVerification").addEventListener("click", async () => {
  if (state.busy || !state.session) return;
  const generation = state.generation;
  setAuthBusy(true);
  try {
    await sendVerificationEmail();
    if (generation === state.generation) message("authMessage", text("verification_sent", "Enviamos o link de confirmação para seu e-mail."));
  } catch {
    if (generation === state.generation) message("authMessage", text("verification_error", "Não foi possível enviar a confirmação. Aguarde e tente novamente."), true);
  } finally { setAuthBusy(false); }
});

$("checkVerification").addEventListener("click", async () => {
  if (state.busy || !state.session) return;
  setAuthBusy(true);
  try { await loadPassport(); } finally { setAuthBusy(false); }
});

$("resetPassword").addEventListener("click", async () => {
  if (state.busy || !firebaseConfigured() || !state.publicReady) return;
  if (!$("email").reportValidity()) return;
  setAuthBusy(true);
  try {
    await firebaseRequest("accounts:sendOobCode", { requestType: "PASSWORD_RESET", email: $("email").value.trim().toLowerCase() });
  } catch { /* Mesma mensagem para evitar revelar se o e-mail tem cadastro. */ }
  finally {
    setAuthBusy(false);
    message("authMessage", text("reset_sent", "Se houver uma conta para esse endereço e o envio for permitido, você receberá instruções para redefinir a senha."));
  }
});

$("logoutButton").addEventListener("click", () => {
  state.generation++;
  forgetSession();
  state.mode = "login";
  $("password").value = "";
  clearPassport();
  message("authMessage", "");
  message("pageMessage", "");
});
