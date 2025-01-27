// Default settings
const DEFAULT_SETTINGS = {
  mouseTracking: 'minimal',
  screenshotQuality: 'medium',
  autoScreenshot: true,
  captureKeyboard: true,
  captureFormData: false,
  blurPersonalInfo: true,
  exportFormat: 'html',
  includeScreenshots: true
};

// DOM Elements
const elements = {
  mouseTracking: document.getElementById('mouseTracking'),
  screenshotQuality: document.getElementById('screenshotQuality'),
  autoScreenshot: document.getElementById('autoScreenshot'),
  captureKeyboard: document.getElementById('captureKeyboard'),
  captureFormData: document.getElementById('captureFormData'),
  blurPersonalInfo: document.getElementById('blurPersonalInfo'),
  exportFormat: document.getElementById('exportFormat'),
  includeScreenshots: document.getElementById('includeScreenshots'),
  clearData: document.getElementById('clearData'),
  sessionCount: document.getElementById('sessionCount'),
  storageUsed: document.getElementById('storageUsed')
};

// Initialize options page
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  setupEventListeners();
  updateStorageInfo();
  // Update storage info every 30 seconds
  setInterval(updateStorageInfo, 30000);
});

// Load saved settings
async function loadSettings() {
  const { settings = DEFAULT_SETTINGS } = await chrome.storage.local.get('settings');
  
  // Update UI with saved settings
  Object.entries(settings).forEach(([key, value]) => {
    const element = elements[key];
    if (!element) return;

    if (element.type === 'checkbox') {
      element.checked = value;
    } else {
      element.value = value;
    }
  });
}

// Save settings
async function saveSettings() {
  const settings = {};
  
  // Collect current settings from UI
  Object.entries(elements).forEach(([key, element]) => {
    if (!element || key === 'clearData' || key === 'sessionCount' || key === 'storageUsed') return;
    
    settings[key] = element.type === 'checkbox' ? element.checked : element.value;
  });
  
  // Save to storage
  await chrome.storage.local.set({ settings });
  
  // Notify that settings have changed
  chrome.runtime.sendMessage({ type: 'SETTINGS_UPDATED', settings });
}

// Set up event listeners
function setupEventListeners() {
  // Add change listeners to all inputs
  Object.entries(elements).forEach(([key, element]) => {
    if (!element || key === 'clearData' || key === 'sessionCount' || key === 'storageUsed') return;
    
    element.addEventListener('change', () => {
      saveSettings();
      // Show save confirmation
      showSaveConfirmation();
    });
  });
  
  // Clear data button
  elements.clearData.addEventListener('click', clearAllData);
}

// Show temporary save confirmation
function showSaveConfirmation() {
  const confirmation = document.createElement('div');
  confirmation.textContent = 'Settings saved';
  confirmation.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: var(--success-color);
    color: white;
    padding: 8px 16px;
    border-radius: 4px;
    animation: fadeOut 2s forwards;
  `;
  
  document.body.appendChild(confirmation);
  setTimeout(() => confirmation.remove(), 2000);
}

// Update storage usage information
async function updateStorageInfo() {
  const { sopData = { sessions: [] } } = await chrome.storage.local.get('sopData');
  
  // Update session count
  elements.sessionCount.textContent = sopData.sessions.length;
  
  // Calculate storage usage
  chrome.storage.local.getBytesInUse(null, (bytes) => {
    const megabytes = (bytes / (1024 * 1024)).toFixed(2);
    elements.storageUsed.textContent = `${megabytes} MB`;
  });
}

// Clear all stored data
async function clearAllData() {
  if (!confirm('Are you sure you want to clear all stored data? This action cannot be undone.')) {
    return;
  }
  
  try {
    // Clear everything except settings
    const { settings } = await chrome.storage.local.get('settings');
    await chrome.storage.local.clear();
    await chrome.storage.local.set({ 
      settings,
      sopData: { sessions: [], currentSession: null }
    });
    
    // Update UI
    updateStorageInfo();
    
    // Show confirmation
    alert('All data has been cleared successfully.');
  } catch (error) {
    console.error('Error clearing data:', error);
    alert('An error occurred while clearing data. Please try again.');
  }
}

// Add custom styles for the save confirmation animation
const style = document.createElement('style');
style.textContent = `
  @keyframes fadeOut {
    0% { opacity: 1; transform: translateY(0); }
    70% { opacity: 1; transform: translateY(0); }
    100% { opacity: 0; transform: translateY(20px); }
  }
`;
document.head.appendChild(style);