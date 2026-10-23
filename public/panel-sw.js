self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = {};
  }
  const title = typeof data.title === "string" && data.title.trim() ? data.title.trim() : "Panel Lia Style";
  const body = typeof data.body === "string" ? data.body : "";
  const url = typeof data.url === "string" && data.url.startsWith("/panel-turnos") ? data.url : "/panel-turnos";
  event.waitUntil(
    self.registration.showNotification(title, {
      body,
      icon: "/icon-192.png",
      data: { url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  const path = typeof raw === "string" && raw.startsWith("/panel-turnos") ? raw : "/panel-turnos";
  const target = new URL(path, self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(async (windowClients) => {
      for (const client of windowClients) {
        if (!client.url.includes("/panel-turnos")) continue;
        if ("navigate" in client && typeof client.navigate === "function") {
          try {
            await client.navigate(target);
          } catch {
            /* Si no puede navegar, igual se enfoca la ventana abierta. */
          }
        }
        return client.focus();
      }
      return self.clients.openWindow(target);
    }),
  );
});
