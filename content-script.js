console.log('Content script loaded');

// State management
const state = {
  isRecording: false,
  sessionId: null,
  interactionLog: [],
  initialized: false,
  currentInput: {
    element: null,
    text: '',
    lastUpdate: null,
    initialValue: ''
  },
  buffer: {
    actions: [],
    timeout: null,
    processingInterval: null
  }
};

// Buffer configuration
const BUFFER_PROCESS_INTERVAL = 1000; // Process buffer every second
const BUFFER_MAX_SIZE = 10; // Maximum number of actions to store before processing

// Helper function to clean and format text
function formatInputText(text) {
  // Remove extra whitespace and special characters
  text = text.trim().replace(/\s+/g, ' ');
  
  // Remove any non-printable characters
  text = text.replace(/[^\x20-\x7E]/g, '');
  
  return `Type ${text} into the field`;
}

// Initialize content script
async function initialize() {
  if (state.initialized) return;
  
  console.log('Initializing content script');
  setupEventListeners();
  setupRecordingIndicator();
  setupMainWindow();
  state.initialized = true;
  
  // Check if there's an active recording session
  try {
    const { sopData } = await chrome.storage.local.get('sopData');
    if (sopData?.currentSession) {
      console.log('Restoring recording state');
      startRecording(sopData.currentSession.id);
    }
  } catch (error) {
    console.error('Error checking recording state:', error);
  }
  
  // Notify background script that content script is ready
  chrome.runtime.sendMessage({
    type: 'CONTENT_SCRIPT_READY',
    url: window.location.href
  });
}

// Set up main window
function setupMainWindow() {
  const mainWindow = document.createElement('div');
  mainWindow.className = 'sop-main-window';
  mainWindow.innerHTML = `
    <h2 style="margin-top: 0;">SOP Generator</h2>
    <div id="sop-content"></div>
  `;
  document.body.appendChild(mainWindow);
}

// Function to throttle frequent events
function throttle(func, limit) {
  let inThrottle;
  return function(...args) {
    if (!inThrottle) {
      func.apply(this, args);
      inThrottle = true;
      setTimeout(() => inThrottle = false, limit);
    }
  };
}

// Set up all event listeners
function setupEventListeners() {
  console.log('Setting up event listeners');

  // Create click visualization element
  const clickVisual = document.createElement('div');
  clickVisual.className = 'sop-click-indicator';
  document.body.appendChild(clickVisual);

  // Function to show click visualization
  function showClickVisual(x, y) {
    clickVisual.style.left = (x - 25) + 'px';  // Center the circle
    clickVisual.style.top = (y - 25) + 'px';   // Center the circle
    clickVisual.style.opacity = '0.3';
    
    setTimeout(() => {
      clickVisual.style.opacity = '0';
    }, 500);
  }

  // Capture all mouse clicks
  document.addEventListener("mousedown", async (e) => {
    if (!state.isRecording) return;

    const element = e.target;
    let clickType;
    switch (e.button) {
      case 0:
        clickType = "left click";
        break;
      case 1:
        clickType = "middle click";
        break;
      case 2:
        clickType = "right click";
        break;
      default:
        clickType = "click";
    }

    const eventData = {
      type: "mouse_click",
      clickType: clickType,
      x: e.clientX,
      y: e.clientY,
      element: element.tagName.toLowerCase(),
      id: element.id || "",
      className: element.className || "",
      text: element.textContent?.trim().substring(0, 50) || "",
      href: element.href || "",
      role: element.getAttribute('role') || "",
      ariaLabel: element.getAttribute('aria-label') || "",
      placeholder: element.placeholder || "",
      name: element.name || "",
      timestamp: new Date().toISOString()
    };
    
    // Show click visualization
    showClickVisual(e.clientX, e.clientY);
    
    logInteraction(eventData);
    await requestScreenshot();
  });

  // Prevent context menu from showing on right click
  document.addEventListener("contextmenu", (e) => {
    if (state.isRecording) {
      e.preventDefault();
    }
  });

  // Handle input changes
  document.addEventListener("input", (e) => {
    if (!state.isRecording) return;
    
    const element = e.target;
    if (element.type === "password" || element.dataset.sensitive) {
      return;
    }

    // Update current input state
    state.currentInput.element = element;
    state.currentInput.text = element.value;
    state.currentInput.lastUpdate = Date.now();
    state.currentInput.inputStart = state.currentInput.inputStart || Date.now();
    state.currentInput.initialValue = state.currentInput.initialValue || '';
  });

  // Handle input start
  document.addEventListener("focus", (e) => {
    if (!state.isRecording) return;
    
    const element = e.target;
    if (element.type === "password" || element.dataset.sensitive) {
      return;
    }

    // Initialize input tracking
    state.currentInput.element = element;
    state.currentInput.inputStart = Date.now();
    state.currentInput.initialValue = element.value;
    state.currentInput.text = element.value;
  });

  // Prevent form submission refresh
  document.addEventListener("submit", (e) => {
    if (state.isRecording) {
      e.preventDefault();
      logInputCompletion();
    }
  });

  // Handle Enter key
  document.addEventListener("keydown", (e) => {
    if (state.isRecording && e.key === "Enter") {
      const element = e.target;
      if (element.tagName.toLowerCase() === "input" &&
          element.form &&
          !e.shiftKey) {
        e.preventDefault();
        logInputCompletion();
      }
    }
  });

  // Handle input completion (when focus leaves the input or after a delay)
  document.addEventListener("blur", async (e) => {
    if (!state.isRecording) return;
    
    const element = e.target;
    if (element === state.currentInput.element) {
      await logInputCompletion();
    }
  }, true);

  // Set up message listener
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    console.log('Content script received message:', message);
    
    switch (message.type) {
      case "START_RECORDING":
        startRecording(message.sessionId);
        sendResponse({ status: "Recording started" });
        break;
      case "STOP_RECORDING":
        stopRecording();
        sendResponse({ status: "Recording stopped" });
        // Send any pending data before stopping
        if (state.currentInput.element) {
          logInputCompletion();
        }
        sendInteractionData();
        break;
    }
    return true;
  });

  // Set up periodic data sending and input checking
  setInterval(() => {
    sendInteractionData();
    checkPendingInput();
  }, 2000);
}

// Check for pending input and log if complete
function checkPendingInput() {
  if (state.currentInput.element && state.currentInput.lastUpdate) {
    const timeSinceUpdate = Date.now() - state.currentInput.lastUpdate;
    if (timeSinceUpdate > 1000) { // Log after 1 second of no changes
      logInputCompletion();
    }
  }
}

// Log completed input
async function logInputCompletion() {
  if (!state.currentInput.element || state.currentInput.text === state.currentInput.initialValue) return;

  const element = state.currentInput.element;
  
  const description = formatInputText(state.currentInput.text);

  const eventData = {
    type: "text_input",
    element: element.tagName.toLowerCase(),
    inputType: element.type || 'text',
    description: description,
    text: state.currentInput.text,
    timestamp: new Date().toISOString()
  };
  
  logInteraction(eventData);
  await requestScreenshot();  // Take screenshot after input completion

  // Reset current input state
  state.currentInput = {
    element: null,
    text: '',
    lastUpdate: null,
    initialValue: ''
  };
}

// Start recording
function startRecording(sessionId) {
  console.log('Starting recording for session:', sessionId);
  state.isRecording = true;
  state.sessionId = sessionId;
  state.interactionLog = [];
  state.buffer.actions = [];
  updateRecordingIndicator(true);
  
  // Initialize buffer processing
  initializeBuffer();
  
  // Show main window and reset content
  const mainWindow = document.querySelector('.sop-main-window');
  if (mainWindow) {
    mainWindow.style.display = 'block';
    const contentElement = document.getElementById('sop-content');
    if (contentElement) {
      contentElement.innerHTML = '<p>No steps recorded yet.</p>';
    }
  }
}

// Stop recording
function stopRecording() {
  console.log('Stopping recording');
  
  // Process any remaining buffered actions
  processBuffer();
  
  if (state.currentInput.element) {
    logInputCompletion(); // Log any pending input
  }
  
  // Clear buffer interval
  if (state.buffer.processingInterval) {
    clearInterval(state.buffer.processingInterval);
    state.buffer.processingInterval = null;
  }
  
  state.isRecording = false;
  sendInteractionData(); // Send any remaining data
  state.sessionId = null;
  state.buffer.actions = [];
  updateRecordingIndicator(false);
  
  // Hide main window
  const mainWindow = document.querySelector('.sop-main-window');
  if (mainWindow) {
    mainWindow.style.display = 'none';
  }
}

// Buffer management functions
function initializeBuffer() {
  if (state.buffer.processingInterval) {
    clearInterval(state.buffer.processingInterval);
  }
  
  state.buffer.processingInterval = setInterval(() => {
    processBuffer();
  }, BUFFER_PROCESS_INTERVAL);
}

function addToBuffer(eventData) {
  if (!state.isRecording) return;
  
  state.buffer.actions.push({
    ...eventData,
    timestamp: new Date().toISOString()
  });
  
  // Process immediately if buffer is full
  if (state.buffer.actions.length >= BUFFER_MAX_SIZE) {
    processBuffer();
  }
}

function processBuffer() {
  if (!state.buffer.actions.length) return;
  
  console.log('Processing buffer:', state.buffer.actions.length, 'actions');
  
  // Sort actions by timestamp
  const sortedActions = state.buffer.actions.sort((a, b) =>
    new Date(a.timestamp) - new Date(b.timestamp)
  );
  
  // Add to interaction log
  sortedActions.forEach(action => {
    state.interactionLog.push(action);
  });
  
  // Clear buffer
  state.buffer.actions = [];
  
  // Update UI without causing refresh
  requestAnimationFrame(() => {
    updateMainWindowContent();
  });
}

// Log interaction
function logInteraction(eventData) {
  if (!state.isRecording) return;
  console.log('Buffering interaction:', eventData);
  addToBuffer(eventData);
}

// Update main window content
function updateMainWindowContent() {
  const contentElement = document.getElementById('sop-content');
  if (!contentElement) return;

  const steps = state.interactionLog.map((event, index) => {
    let stepText = '';
    switch (event.type) {
      case 'mouse_click':
        stepText = `Click ${event.clickType} on ${event.element}`;
        if (event.text) stepText += ` with text "${event.text}"`;
        break;
      case 'text_input':
        stepText = event.description;
        break;
      case 'navigation':
        stepText = `Navigate to ${event.title || event.to}`;
        break;
    }
    return `<div style="margin-bottom: 10px;">
      <strong>Step ${index + 1}:</strong> ${stepText}
    </div>`;
  }).join('');

  contentElement.innerHTML = steps || '<p>No steps recorded yet.</p>';
}

// Send interaction data to background script
function sendInteractionData() {
  if (!state.isRecording || state.interactionLog.length === 0) return;
  
  console.log('Sending interaction data:', state.interactionLog.length, 'events');
  chrome.runtime.sendMessage({
    type: "LOG_DATA",
    payload: {
      url: window.location.href,
      title: document.title,
      data: state.interactionLog
    }
  }).catch(error => {
    console.error('Error sending interaction data:', error);
  });
  
  state.interactionLog = [];
}

// Request screenshot
async function requestScreenshot() {
  if (!state.isRecording) return;
  
  try {
    await chrome.runtime.sendMessage({
      type: "TAKE_SCREENSHOT"
    });
  } catch (error) {
    if (!error.message.includes('message channel closed')) {
      console.error('Error requesting screenshot:', error);
    }
  }
}

// Set up recording indicator
function setupRecordingIndicator() {
  const indicator = document.createElement('div');
  indicator.id = 'sop-recording-indicator';
  indicator.style.cssText = `
    position: fixed;
    top: 10px;
    right: 10px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    background-color: #ff0000;
    z-index: 9999;
    transition: opacity 0.3s;
    opacity: 0;
  `;
  document.body.appendChild(indicator);
}

// Update recording indicator
function updateRecordingIndicator(isRecording) {
  const indicator = document.getElementById('sop-recording-indicator');
  if (indicator) {
    indicator.style.opacity = isRecording ? '1' : '0';
  }
}

// Helper function to find the associated label for an input element
function findInputLabel(element) {
  // First try to find label by for attribute
  if (element.id) {
    const label = document.querySelector(`label[for="${element.id}"]`);
    if (label) return label.textContent.trim();
  }
  
  // Then try to find parent label
  const parentLabel = element.closest('label');
  if (parentLabel) return parentLabel.textContent.trim();
  
  // Finally try to find preceding label or text
  const previousElement = element.previousElementSibling;
  if (previousElement && previousElement.tagName.toLowerCase() === 'label') {
    return previousElement.textContent.trim();
  }
  
  return '';
}

// Track page navigation
let lastUrl = window.location.href;

// Create a function to handle URL changes
async function handleUrlChange() {
  if (!state.isRecording) return;
  
  const currentUrl = window.location.href;
  if (currentUrl !== lastUrl) {
    const eventData = {
      type: "navigation",
      from: lastUrl,
      to: currentUrl,
      title: document.title,
      timestamp: new Date().toISOString()
    };
    logInteraction(eventData);
    await requestScreenshot();  // Take screenshot after navigation
    lastUrl = currentUrl;
  }
}

// Set up URL change detection
const observer = new MutationObserver(async () => {
  await handleUrlChange();
});

observer.observe(document, {
  subtree: true,
  childList: true
});

// Also handle popstate events for back/forward navigation
window.addEventListener('popstate', async () => {
  await handleUrlChange();
});

// Initialize the content script
initialize();