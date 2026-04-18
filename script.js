// --- Config ---
const WORKER_URL = "https://loreal-chatbot.qv-orpheus.workers.dev";
const STORAGE_KEY = "loreal.selectedIds";

// --- DOM refs ---
const categoryFilter = document.getElementById("categoryFilter");
const productSearch = document.getElementById("productSearch");
const productsContainer = document.getElementById("productsContainer");
const selectedList = document.getElementById("selectedProductsList");
const generateBtn = document.getElementById("generateRoutine");
const clearAllBtn = document.getElementById("clearAll");
const rtlToggle = document.getElementById("rtlToggle");
const chatForm = document.getElementById("chatForm");
const chatWindow = document.getElementById("chatWindow");
const userInput = document.getElementById("userInput");

// --- State ---
let allProducts = [];
// Load saved selection from localStorage so picks persist across reloads
let selectedIds = new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]"));

// Conversation history sent to the model on every call
const messages = [
  {
    role: "system",
    content:
      "You are the L'Oréal Beauty Advisor. You only help with L'Oréal family products (L'Oréal Paris, CeraVe, Garnier, Lancôme, La Roche-Posay, Vichy, Kiehl's, Kérastase, Maybelline, Urban Decay, YSL, Redken, SkinCeuticals) and beauty topics (skincare, haircare, makeup, fragrance). When given a JSON list of selected products, build a clear step-by-step routine using ONLY those products, noting order and AM/PM use. Politely refuse anything off-topic in one sentence."
  }
];

// --- Helpers ---

// Save the current selection to localStorage
function persistSelection() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify([...selectedIds]));
}

// Load the product list from the JSON file
async function loadProducts() {
  const response = await fetch("products.json");
  const data = await response.json();
  allProducts = data.products;
  renderProducts();
}

// Filter by category AND search text, then draw the cards
function renderProducts() {
  const category = categoryFilter.value;
  const query = (productSearch.value || "").trim().toLowerCase();

  // Apply both filters; each one is optional
  const filtered = allProducts.filter((p) => {
    const matchCat = !category || p.category === category;
    const matchText =
      !query ||
      p.name.toLowerCase().includes(query) ||
      p.brand.toLowerCase().includes(query) ||
      p.description.toLowerCase().includes(query);
    return matchCat && matchText;
  });

  // Show a placeholder if nothing to display yet
  if (filtered.length === 0) {
    productsContainer.innerHTML = `
      <div class="placeholder-message">
        ${category || query ? "No products match your search." : "Select a category to view products"}
      </div>
    `;
    return;
  }

  // Build the grid; mark cards that are currently selected
  productsContainer.innerHTML = filtered
    .map((product) => {
      const isSelected = selectedIds.has(product.id) ? "selected" : "";
      return `
        <div class="product-card ${isSelected}" data-id="${product.id}">
          <img src="${product.image}" alt="${product.name}">
          <div class="product-info">
            <h3>${product.name}</h3>
            <p>${product.brand}</p>
            <button class="description-toggle" type="button" data-id="${product.id}">
              Show description
            </button>
            <div class="product-description" data-id="${product.id}">
              ${product.description}
            </div>
          </div>
        </div>
      `;
    })
    .join("");
}

// Toggle a product's selected state and refresh the UI
function toggleSelect(id) {
  if (selectedIds.has(id)) {
    selectedIds.delete(id);
  } else {
    selectedIds.add(id);
  }
  persistSelection();
  renderProducts();
  renderSelectedList();
}

// Show each selected product with an ✕ remove button
function renderSelectedList() {
  const picks = allProducts.filter((p) => selectedIds.has(p.id));

  if (picks.length === 0) {
    selectedList.innerHTML = `<p style="color:#666;">No products selected yet.</p>`;
    return;
  }

  selectedList.innerHTML = picks
    .map(
      (p) => `
        <div class="selected-item">
          <span>${p.name}</span>
          <button type="button" data-remove="${p.id}" aria-label="Remove">✕</button>
        </div>
      `
    )
    .join("");
}

// Remove every selected product
function clearAll() {
  selectedIds.clear();
  persistSelection();
  renderProducts();
  renderSelectedList();
}

// Append a message bubble to the chat window and scroll to bottom
function addMessage(role, text) {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  chatWindow.appendChild(div);
  chatWindow.scrollTop = chatWindow.scrollHeight;
}

// Send the current messages array to the Worker and return the reply text
async function callOpenAI() {
  try {
    const response = await fetch(WORKER_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o-search-preview",
        messages: messages
      })
    });
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (err) {
    return "Sorry — I couldn't reach the advisor right now. Please try again.";
  }
}

// --- Event wiring ---

// Re-filter when the category changes
categoryFilter.addEventListener("change", renderProducts);

// Re-filter as the user types a search term
productSearch.addEventListener("input", renderProducts);

// Clear-all button empties the selection
clearAllBtn.addEventListener("click", clearAll);

// Flip document direction for RTL support
rtlToggle.addEventListener("click", () => {
  const current = document.documentElement.dir || "ltr";
  document.documentElement.dir = current === "ltr" ? "rtl" : "ltr";
});

// Clicks inside the grid: select a card or toggle its description
productsContainer.addEventListener("click", (e) => {
  // Description toggle button — don't trigger card selection
  const toggleBtn = e.target.closest(".description-toggle");
  if (toggleBtn) {
    e.stopPropagation();
    const id = Number(toggleBtn.dataset.id);
    const desc = productsContainer.querySelector(
      `.product-description[data-id="${id}"]`
    );
    if (desc) {
      desc.classList.toggle("visible");
      toggleBtn.textContent = desc.classList.contains("visible")
        ? "Hide description"
        : "Show description";
    }
    return;
  }

  // Otherwise select/unselect the card
  const card = e.target.closest(".product-card");
  if (card) {
    toggleSelect(Number(card.dataset.id));
  }
});

// Remove a single item from the selected list via its ✕ button
selectedList.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-remove]");
  if (btn) {
    toggleSelect(Number(btn.dataset.remove));
  }
});

// Generate a routine from the currently selected products
generateBtn.addEventListener("click", async () => {
  const picks = allProducts.filter((p) => selectedIds.has(p.id));
  if (picks.length === 0) {
    addMessage("assistant", "Please select at least one product first.");
    return;
  }

  // Only send the fields the model needs
  const payload = picks.map((p) => ({
    name: p.name,
    brand: p.brand,
    category: p.category,
    description: p.description
  }));

  const userText = `Please create a routine using these products: ${JSON.stringify(payload)}`;
  messages.push({ role: "user", content: userText });
  addMessage("user", "Generating a routine from my selected products…");

  const reply = await callOpenAI();
  messages.push({ role: "assistant", content: reply });
  addMessage("assistant", reply);
});

// Follow-up chat: keeps full history in messages[]
chatForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = userInput.value.trim();
  if (!text) return;

  messages.push({ role: "user", content: text });
  addMessage("user", text);
  userInput.value = "";

  const reply = await callOpenAI();
  messages.push({ role: "assistant", content: reply });
  addMessage("assistant", reply);
});

// --- Startup ---
loadProducts();
renderSelectedList();
