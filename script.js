/* ========= Config ========= */
const WORKER_URL = "https://withered-king-c68b.wwardhana.workers.dev/";

const LS_SELECTED_KEY = "loreal_selected_ids_v1";
const LS_CHAT_KEY = "loreal_chat_history_v1";

/* ========= DOM ========= */
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedProductsList = document.getElementById("selectedProductsList");
const clearSelectionsBtn = document.getElementById("clearSelections");
const generateBtn = document.getElementById("generateRoutine");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");
const rtlToggle = document.getElementById("rtlToggle");
const descModal = document.getElementById("descModal");
const descTitle = document.getElementById("descTitle");
const descBody = document.getElementById("descBody");

/* ========= State ========= */
let allProducts = [];
let selectedIds = new Set(
  JSON.parse(localStorage.getItem(LS_SELECTED_KEY) || "[]")
);
let messages = JSON.parse(localStorage.getItem(LS_CHAT_KEY) || "[]"); // [{role, content}]

/* ========= Utils ========= */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function saveSelections() {
  localStorage.setItem(
    LS_SELECTED_KEY,
    JSON.stringify(Array.from(selectedIds))
  );
}
function saveChat() {
  localStorage.setItem(LS_CHAT_KEY, JSON.stringify(messages));
}

function renderMessage(role, content) {
  const wrap = document.createElement("div");
  wrap.className = `message ${role}`;
  const bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.innerHTML = content
    .replace(/\n/g, "<br>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>");
  wrap.appendChild(bubble);
  chatWindow.appendChild(wrap);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}
function typing(state) {
  const id = "typing-indicator";
  if (state) {
    const el = document.createElement("div");
    el.id = id;
    el.className = "message assistant";
    el.innerHTML = `<div class="bubble"><em>typing…</em></div>`;
    chatWindow.appendChild(el);
  } else {
    const el = document.getElementById(id);
    el && el.remove();
  }
}

function normalize(str) {
  return (str || "").toLowerCase();
}

/* ========= Data ========= */
async function loadProducts() {
  if (allProducts.length) return allProducts;
  const response = await fetch("products.json");
  const data = await response.json();
  allProducts = data.products || [];
  return allProducts;
}

/* ========= Rendering ========= */
function productCardHTML(p) {
  const isSelected = selectedIds.has(p.id);
  return `
    <article class="product-card ${isSelected ? "selected" : ""}" data-id="${
    p.id
  }" tabindex="0" aria-pressed="${isSelected}">
      <span class="select-badge"><i class="fa-solid fa-check"></i> Selected</span>
      <img src="${p.image}" alt="${p.name}" />
      <div class="product-info">
        <h3>${p.name}</h3>
        <p>${p.brand}</p>
        <div class="card-actions">
          <span class="pill"><i class="fa-solid fa-tag"></i> ${
            p.category
          }</span>
          <button class="pill details-btn" type="button" data-action="details" data-id="${
            p.id
          }">
            <i class="fa-regular fa-circle-question"></i> Details
          </button>
        </div>
      </div>
    </article>
  `;
}

function renderProductsGrid(list) {
  if (!list.length) {
    productsContainer.innerHTML = `<div class="placeholder-message">No products match your filters.</div>`;
    return;
  }
  productsContainer.innerHTML = list.map(productCardHTML).join("");
}

function renderSelectedChips() {
  const items = allProducts.filter((p) => selectedIds.has(p.id));
  if (!items.length) {
    selectedProductsList.innerHTML = `<div class="placeholder-message" style="border:none;padding:12px;background:#fafafa">No products selected yet.</div>`;
    return;
  }
  selectedProductsList.innerHTML = items
    .map(
      (p) => `
      <span class="selected-chip" data-id="${p.id}">
        ${p.name}
        <button class="remove-chip" title="Remove ${p.name}" aria-label="Remove ${p.name}" data-id="${p.id}">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </span>
    `
    )
    .join("");
}

/* ========= Selection handlers ========= */
function toggleSelection(id) {
  if (selectedIds.has(id)) selectedIds.delete(id);
  else selectedIds.add(id);
  saveSelections();
  // Re-render both grid and chips for accuracy
  applyFiltersAndRender();
  renderSelectedChips();
}

/* ========= Filters ========= */
function applyFiltersAndRender() {
  const cat = categoryFilter.value.trim();
  const q = normalize(productSearch.value.trim());

  let list = [...allProducts];
  if (cat) list = list.filter((p) => p.category === cat);
  if (q) {
    list = list.filter((p) => {
      const hay = normalize(
        `${p.name} ${p.brand} ${p.description} ${p.category}`
      );
      return hay.includes(q);
    });
  }
  renderProductsGrid(list);
}

/* ========= Description modal ========= */
function openDescription(product) {
  // On wide screens the card already has a details button, but we also provide modal for small screens / a11y
  descTitle.textContent = `${product.brand} — ${product.name}`;
  descBody.textContent = product.description;
  descModal.showModal();
}

/* ========= AI calls ========= */
async function callWorker(messagesPayload) {
  // Your Worker expects: { messages: [...] }
  const res = await fetch(WORKER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages: messagesPayload }),
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`API error ${res.status}: ${txt}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || "(No response)";
  return content;
}

/* ========= Routine generation ========= */
async function generateRoutine() {
  const selected = allProducts.filter((p) => selectedIds.has(p.id));
  if (!selected.length) {
    renderMessage(
      "system",
      "Please select at least one product to generate a routine."
    );
    return;
  }

  // Show the user's action in chat
  renderMessage("user", "Generate a routine using my selected products.");
  typing(true);

  // Build a concise JSON payload for the assistant
  const compact = selected.map(
    ({ id, brand, name, category, description }) => ({
      id,
      brand,
      name,
      category,
      description,
    })
  );

  // Seed/continue the conversation. We add one user turn that includes the product JSON.
  const convo = [
    ...messages,
    {
      role: "user",
      content:
        "Here are the selected products in JSON. Please create a step-by-step AM/PM routine (bullets), short usage notes, conflicts/duplications to avoid, and optional add-ons. JSON:\n" +
        JSON.stringify(compact, null, 2),
    },
  ];

  try {
    const assistantText = await callWorker(convo);
    typing(false);
    renderMessage("assistant", assistantText);

    // Persist new conversation turns
    messages = convo.concat([{ role: "assistant", content: assistantText }]);
    saveChat();
  } catch (e) {
    typing(false);
    renderMessage("system", `Error generating routine: ${e.message}`);
  }
}

/* ========= Chat submit ========= */
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  // Show user's message
  renderMessage("user", text);
  userInput.value = "";

  // Keep chat strictly on-topic. We rely on your Worker's strict system prompt.
  typing(true);
  const convo = messages.concat([{ role: "user", content: text }]);

  try {
    const assistantText = await callWorker(convo);
    typing(false);
    renderMessage("assistant", assistantText);
    messages = convo.concat([{ role: "assistant", content: assistantText }]);
    saveChat();
  } catch (e2) {
    typing(false);
    renderMessage("system", `Error: ${e2.message}`);
  }
});

/* ========= Events ========= */
categoryFilter.addEventListener("change", applyFiltersAndRender);

let searchTimer;
productSearch.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(applyFiltersAndRender, 150);
});

productsContainer.addEventListener("click", (e) => {
  const detailsBtn = e.target.closest("button[data-action='details']");
  if (detailsBtn) {
    const id = Number(detailsBtn.dataset.id);
    const product = allProducts.find((p) => p.id === id);
    if (product) openDescription(product);
    return;
  }
  const card = e.target.closest(".product-card");
  if (!card) return;
  const id = Number(card.dataset.id);
  toggleSelection(id);
});
productsContainer.addEventListener("keydown", (e) => {
  if (e.key === "Enter" || e.key === " ") {
    const card = e.target.closest(".product-card");
    if (card) {
      e.preventDefault();
      toggleSelection(Number(card.dataset.id));
    }
  }
});

selectedProductsList.addEventListener("click", (e) => {
  const btn = e.target.closest(".remove-chip");
  if (!btn) return;
  const id = Number(btn.dataset.id);
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
    saveSelections();
    applyFiltersAndRender();
    renderSelectedChips();
  }
});

clearSelectionsBtn.addEventListener("click", () => {
  selectedIds.clear();
  saveSelections();
  applyFiltersAndRender();
  renderSelectedChips();
});

generateBtn.addEventListener("click", generateRoutine);

rtlToggle.addEventListener("change", (e) => {
  document.documentElement.setAttribute(
    "dir",
    e.target.checked ? "rtl" : "ltr"
  );
});

/* ========= Init ========= */
(async function init() {
  await loadProducts();
  applyFiltersAndRender();
  renderSelectedChips();

  // Restore chat
  if (messages.length) {
    messages.forEach((m) => renderMessage(m.role, m.content));
  } else {
    renderMessage(
      "assistant",
      "Hi! Choose a category or search, click products to select them, then press <strong>Generate Routine</strong>. I’ll tailor AM/PM steps and usage tips for you."
    );
  }
})();
