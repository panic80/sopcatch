// Handle messages from content scripts and manage data storage

// Track active recording state
let activeRecordingTabId = null;

// Initialize storage structure
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Initializing storage');
  try {
    const data = await chrome.storage.local.get(['sopData', 'extensionEnabled']);
    if (!data.sopData) {
      await chrome.storage.local.set({
        sopData: {
          sessions: [],
          currentSession: null
        }
      });
      console.log('Storage initialized');
    }
    if (data.extensionEnabled === undefined) {
      await chrome.storage.local.set({ extensionEnabled: true });
      console.log('Extension state initialized');
    }
  } catch (error) {
    console.error('Error initializing storage:', error);
  }
});

// Handle navigation events
chrome.webNavigation.onCompleted.addListener(async (details) => {
  // Only handle main frame navigation
  if (details.frameId !== 0) return;
  
  // Check if this tab is being recorded
  if (details.tabId === activeRecordingTabId) {
    console.log('Recorded tab navigated, reinjecting content script');
    try {
      // Get current recording session
      const { sopData } = await chrome.storage.local.get('sopData');
      if (!sopData?.currentSession) {
        console.warn('No active session found after navigation');
        return;
      }

      // Inject content script
      await chrome.scripting.executeScript({
        target: { tabId: details.tabId },
        files: ['content-script.js']
      });

      // Restore recording state
      await chrome.tabs.sendMessage(details.tabId, {
        type: 'START_RECORDING',
        sessionId: sopData.currentSession.id
      });

      console.log('Content script reinjected and recording restored');
    } catch (error) {
      console.error('Error handling navigation:', error);
    }
  }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message.type);

  if (message.type === 'EXTENSION_STATE_CHANGED') {
    console.log('Extension state changed:', message.enabled);
    return true;
  }

  // Check if action requires extension to be enabled
  const recordingActions = ['START_SESSION', 'LOG_DATA', 'TAKE_SCREENSHOT'];
  if (recordingActions.includes(message.type)) {
    chrome.storage.local.get('extensionEnabled').then(({ extensionEnabled = true }) => {
      if (!extensionEnabled) {
        console.log('Extension is disabled, ignoring action:', message.type);
        sendResponse({ success: false, error: 'Extension is disabled' });
        return;
      }
      handleMessage(message, sender, sendResponse);
    });
    return true;
  }

  // Handle non-recording actions normally
  handleMessage(message, sender, sendResponse);
  return true;
});

function handleMessage(message, sender, sendResponse) {
  switch (message.type) {
    case 'START_SESSION':
      handleStartSession().then(() => sendResponse({ success: true }));
      break;
    case 'END_SESSION':
      handleEndSession().then(() => sendResponse({ success: true }));
      break;
    case 'LOG_DATA':
      handleLogData(message.payload, sender.tab?.id);
      break;
    case 'TAKE_SCREENSHOT':
      handleScreenshot(sender.tab?.id);
      break;
    case 'GET_SESSIONS':
      handleGetSessions(sendResponse);
      break;
    case 'VIEW_SOP':
      handleViewSOP(message.sessionId, sendResponse);
      break;
    case 'EXPORT_SOP':
      handleExportSOP(message.sessionId, sendResponse);
      break;
  }
}

// Start a new recording session
async function handleStartSession() {
  console.log('Starting new session');
  try {
    const session = {
      id: Date.now().toString(),
      startTime: new Date().toISOString(),
      steps: [],
      screenshots: []
    };

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      throw new Error('No active tab found');
    }
    
    // Set active recording tab
    activeRecordingTabId = tab.id;
    console.log('Setting active recording tab:', activeRecordingTabId);

    // Inject content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content-script.js']
      });
      console.log('Content script injected');
    } catch (error) {
      if (!error.message.includes('already injected')) {
        throw error;
      }
    }

    // Save session to storage
    const { sopData } = await chrome.storage.local.get('sopData');
    await chrome.storage.local.set({
      sopData: {
        ...sopData,
        currentSession: session
      }
    });

    // Verify session was saved
    const verification = await chrome.storage.local.get('sopData');
    console.log('Session started:', verification.sopData.currentSession?.id);

    // Notify content script
    await chrome.tabs.sendMessage(tab.id, {
      type: 'START_RECORDING',
      sessionId: session.id
    });

    return session;
  } catch (error) {
    console.error('Error starting session:', error);
    throw error;
  }
}

// End current recording session
async function handleEndSession() {
  console.log('Ending session');
  try {
    const { sopData } = await chrome.storage.local.get('sopData');
    if (!sopData || !sopData.currentSession) {
      console.warn('No active session to end');
      return;
    }

    // Ensure sessions array exists
    if (!Array.isArray(sopData.sessions)) {
      sopData.sessions = [];
    }

    const completedSession = {
      ...sopData.currentSession,
      endTime: new Date().toISOString()
    };

    // Add to sessions array and clear current session
    sopData.sessions.push(completedSession);
    sopData.currentSession = null;

    // Clear active recording tab
    if (activeRecordingTabId) {
      try {
        await chrome.tabs.sendMessage(activeRecordingTabId, {
          type: 'STOP_RECORDING'
        });
      } catch (error) {
        console.warn('Could not notify tab about recording stop:', error);
      }
      activeRecordingTabId = null;
      console.log('Cleared active recording tab');
    }

    // Save updated data
    await chrome.storage.local.set({ sopData });

    // Verify save
    const verification = await chrome.storage.local.get('sopData');
    console.log('Session saved:', {
      totalSessions: verification.sopData.sessions.length,
      lastSessionId: completedSession.id,
      steps: completedSession.steps.length,
      screenshots: completedSession.screenshots.length
    });
  } catch (error) {
    console.error('Error ending session:', error);
    throw error;
  }
}

// Store interaction data
async function handleLogData(payload, tabId) {
  console.log('Handling interaction data from tab:', tabId);
  try {
    const { sopData } = await chrome.storage.local.get('sopData');
    if (!sopData?.currentSession) {
      console.warn('No active session found');
      return;
    }

    // Initialize steps array if needed
    if (!Array.isArray(sopData.currentSession.steps)) {
      sopData.currentSession.steps = [];
    }

    // Process and store the interaction data
    const processedData = {
      timestamp: new Date().toISOString(),
      url: payload.url,
      title: payload.title,
      interactions: payload.data
    };

    sopData.currentSession.steps.push(processedData);
    await chrome.storage.local.set({ sopData });
    console.log('Stored interactions:', processedData.interactions.length);

    // Verify storage
    const verification = await chrome.storage.local.get('sopData');
    console.log('Current session steps:', verification.sopData.currentSession.steps.length);
  } catch (error) {
    console.error('Error storing interaction data:', error);
  }
}

// Capture and store screenshot
async function handleScreenshot(tabId) {
  if (!tabId) {
    console.warn('No tab ID provided for screenshot');
    return;
  }

  try {
    const screenshot = await chrome.tabs.captureVisibleTab(null, { format: 'png' });
    const { sopData } = await chrome.storage.local.get('sopData');
    
    if (!sopData?.currentSession) {
      console.warn('No active session for screenshot');
      return;
    }

    // Initialize screenshots array if needed
    if (!Array.isArray(sopData.currentSession.screenshots)) {
      sopData.currentSession.screenshots = [];
    }

    // Add screenshot with current timestamp
    const timestamp = new Date().toISOString();
    sopData.currentSession.screenshots.push({
      timestamp: timestamp,
      dataUrl: screenshot,
      stepIndex: sopData.currentSession.steps.length - 1
    });

    await chrome.storage.local.set({ sopData });
    console.log('Screenshot saved, total:', sopData.currentSession.screenshots.length);
  } catch (error) {
    console.error('Error capturing screenshot:', error);
  }
}

// Retrieve all sessions
async function handleGetSessions(sendResponse) {
  try {
    const { sopData } = await chrome.storage.local.get('sopData');
    console.log('Retrieved sessions:', sopData?.sessions?.length || 0);
    sendResponse({ sessions: sopData?.sessions || [] });
  } catch (error) {
    console.error('Error retrieving sessions:', error);
    sendResponse({ sessions: [] });
  }
}

// Generate SOP content
function generateSOPContent(session) {
  console.log('Generating SOP for session:', session.id);
  
  let html = `
    <!DOCTYPE html>
    <html>
    <head>
      <title>SOP - ${new Date(session.startTime).toLocaleDateString()}</title>
      <style>
        body { font-family: Arial, sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; }
        .step { margin-bottom: 20px; padding: 15px; border: 1px solid #eee; border-radius: 4px; }
        .step:hover { background-color: #f9f9f9; }
        .screenshot { max-width: 100%; margin-top: 10px; border: 1px solid #ddd; border-radius: 4px; }
        .metadata { color: #666; font-size: 0.9em; background: #f5f5f5; padding: 15px; border-radius: 4px; }
        .step-number { color: #4a90e2; font-weight: bold; }
        .step-details { margin-top: 8px; color: #666; }
      </style>
    </head>
    <body>
      <h1>Standard Operating Procedure</h1>
      <div class="metadata">
        <p>Created: ${new Date(session.startTime).toLocaleString()}</p>
        <p>Duration: ${calculateDuration(session.startTime, session.endTime)}</p>
        <p>Total Steps: ${countSteps(session)}</p>
      </div>
  `;

  let stepNumber = 1;
  session.steps.forEach(step => {
    step.interactions.forEach(interaction => {
      html += `
        <div class="step">
          <div class="step-number">Step ${stepNumber++}</div>
          <p>${getInteractionDescription(interaction)}</p>
          ${findMatchingScreenshot(session, interaction.timestamp)}
        </div>
      `;
    });
  });

  html += `
    </body>
    </html>
  `;

  return html;
}

// Handle SOP viewing
async function handleViewSOP(sessionId, sendResponse) {
  console.log('Handling view SOP request:', sessionId);
  try {
    const { sopData } = await chrome.storage.local.get('sopData');
    const session = sopData.sessions.find(s => s.id === sessionId);
    
    if (!session) {
      console.error('Session not found:', sessionId);
      sendResponse({ success: false, error: 'Session not found' });
      return;
    }

    const sopContent = generateSOPContent(session);
    sendResponse({ success: true, content: sopContent });
  } catch (error) {
    console.error('Error generating SOP:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Handle SOP export
async function handleExportSOP(sessionId, sendResponse) {
  console.log('Handling export SOP request:', sessionId);
  try {
    const { sopData } = await chrome.storage.local.get('sopData');
    const session = sopData.sessions.find(s => s.id === sessionId);
    
    if (!session) {
      console.error('Session not found:', sessionId);
      sendResponse({ success: false, error: 'Session not found' });
      return;
    }

    const sopContent = generateSOPContent(session);
    sendResponse({ success: true, content: sopContent });
  } catch (error) {
    console.error('Error exporting SOP:', error);
    sendResponse({ success: false, error: error.message });
  }
}

// Helper functions
function getInteractionDescription(interaction) {
  switch (interaction.type) {
    case "mouse_click":
      return `Click ${interaction.element}${interaction.text ? ` "${interaction.text}"` : ''}${interaction.id ? ` (ID: ${interaction.id})` : ''}`;
    case "text_input":
      return `Type "${interaction.text}" in ${interaction.element}`;
    default:
      return `Interact with ${interaction.element}`;
  }
}

function calculateDuration(startTime, endTime) {
  const duration = Math.floor((new Date(endTime) - new Date(startTime)) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes} minutes, ${seconds} seconds`;
}

function countSteps(session) {
  return session.steps.reduce((count, step) => count + step.interactions.length, 0);
}

function findMatchingScreenshot(session, timestamp) {
  if (!session.screenshots || session.screenshots.length === 0) return '';
  
  // Find the screenshot taken closest to this interaction
  const targetTime = new Date(timestamp).getTime();
  let closestScreenshot = null;
  let minTimeDiff = Infinity;
  
  session.screenshots.forEach(screenshot => {
    const timeDiff = Math.abs(new Date(screenshot.timestamp).getTime() - targetTime);
    if (timeDiff < minTimeDiff) {
      minTimeDiff = timeDiff;
      closestScreenshot = screenshot;
    }
  });
  
  return closestScreenshot
    ? `<img src="${closestScreenshot.dataUrl}" class="screenshot" alt="Step screenshot">`
    : '';
}