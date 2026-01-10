export async function initNotificationsPage() {
  const container = document.querySelector(".notifications-grid");
  const API_URL = "http://127.0.0.1:8002/api/notifications";

  async function loadNotifications() {
    try {
      const res = await fetch(API_URL);
      if (!res.ok) throw new Error(res.status);
      const data = await res.json();

      if (!Array.isArray(data) || data.length === 0) {
        container.innerHTML = `<div class="notification">
          <span class="notification-text">Нет новых уведомлений</span>
        </div>`;
        return;
      }

      container.innerHTML = data
        .reverse()
        .map(n => `
          <div class="notification ${n.criticality || ""}">
            <span class="notification-id">${n.transaction_id || "—"}</span>
            <span class="notification-text">
              ${n.rules_triggered?.join(", ") || "Без правил"} — 
              сумма: ${n.amount ?? 0} ₽
            </span>
            <a href="${n.transaction_link}" target="_blank" class="link">
              Подробнее
            </a>
          </div>
        `)
        .join("");
    } catch (err) {
      container.innerHTML = `<div class="notification-error ">
        <span class="notification-text">Уведомлений нет</span>
      </div>`;
    }
  }
  loadNotifications();
  setInterval(loadNotifications, 5000);
}
