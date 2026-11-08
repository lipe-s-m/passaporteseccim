// Atalhos de teclado e inicialização. Precisa ser o último script carregado.
document.addEventListener("keydown", event => {
  if (event.key === "Escape" && !$("qrBackdrop").hidden) { closeMyQr(); return; }
  if (!$("modalBackdrop").classList.contains("open")) return;
  if (event.key === "Escape") closeModal();
  if (event.key === "Tab") {
    const first = $("modalClose"), last = $("registrationLink");
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
  }
});

restoreSession();
clearPassport();
loadPublicContent();
loadSponsorStrip();
