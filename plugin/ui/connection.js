/**
 * Shared "evcc connection" section of the property inspectors.
 *
 * The plugin owns the connection: this page only sends the base URL once
 * ({ event: "connect" }) and shows the status the plugin reports back
 * ({ event: "status" }). evcc has no login; the URL is kept in the global
 * settings.
 */
(function () {
  const client = SDPIComponents.streamDeckClient;
  const $ = (id) => document.getElementById(id);

  const STATE_TEXT = {
    connected: "Connected",
    connecting: "Connecting…",
    error: "Connection problem",
    unconfigured: "Not connected",
  };

  function send(payload) {
    client.send("sendToPlugin", payload);
  }

  function showMessage(text, kind) {
    const box = $("evcc-message");
    box.textContent = text || "";
    box.className = `message ${kind || ""}`;
    box.hidden = !text;
  }

  function renderStatus(status) {
    const badge = $("evcc-status");
    badge.className = `status ${status.state}`;
    $("evcc-status-text").textContent = STATE_TEXT[status.state] || status.state;
    $("evcc-status-detail").textContent = status.error
      ? status.error
      : status.state === "connected"
        ? `${status.url} · ${status.loadpointCount} loadpoint${status.loadpointCount === 1 ? "" : "s"}`
        : status.url;

    for (const el of document.querySelectorAll(".requires-connection")) {
      el.hidden = !status.configured;
    }
    if (status.url && !$("evcc-url").value) {
      $("evcc-url").value = status.url;
    }
  }

  client.sendToPropertyInspector.subscribe((message) => {
    const payload = message.payload || {};
    if (payload.event === "status") {
      renderStatus(payload);
    } else if (payload.event === "connect") {
      $("evcc-connect").disabled = false;
      if (payload.ok) {
        const version = payload.version ? ` (evcc ${payload.version})` : "";
        showMessage(`Connected${version}: ${payload.loadpointCount} loadpoint${payload.loadpointCount === 1 ? "" : "s"}`, "success");
      } else {
        showMessage(payload.error, "error");
      }
    }
  });

  const TEMPLATE = `
    <sdpi-item label="evcc">
      <div id="evcc-status" class="status unconfigured">
        <div><strong id="evcc-status-text">…</strong><span id="evcc-status-detail"></span></div>
      </div>
    </sdpi-item>
    <div id="evcc-message" class="message" hidden></div>
    <sdpi-item label="URL"><sdpi-textfield id="evcc-url" placeholder="http://192.168.1.10:8089"></sdpi-textfield></sdpi-item>
    <sdpi-item><sdpi-button id="evcc-connect">Connect</sdpi-button></sdpi-item>
    <p class="hint">Base URL of your evcc instance, reachable from this computer without a login (see the README for Authelia and similar).</p>`;

  window.addEventListener("DOMContentLoaded", () => {
    $("evcc-connection").innerHTML = TEMPLATE;

    $("evcc-connect").addEventListener("click", () => {
      const url = ($("evcc-url").value || "").trim();
      if (!url) {
        showMessage("Please enter the evcc URL", "error");
        return;
      }
      if (!/^https?:\/\//i.test(url)) {
        showMessage("The URL must start with http:// or https://", "error");
        return;
      }
      showMessage("Connecting…", "");
      $("evcc-connect").disabled = true;
      send({ event: "connect", url });
    });

    send({ event: "getStatus" });
  });
})();
