// Popup script to handle user interactions and display status

let recordingStartTime = null;
let durationInterval = null;

// State management
const state = {
  updateTimeout: null,
  recordingStartTime: null,
  durationInterval: null
};

// DOM Elements
const startButton = document.getElementById('startRecording');
const stopButton = document.getElementById('stopRecording');
const recordingStatus = document.getElementById('recordingStatus');
const durationElement = document.getElementById('duration');
const stepCountElement = document.getElementById('stepCount');
const viewSessionsButton = document.getElementById('viewSessions');
const sessionsList = document.getElementById('sessionsList');
const sessionsContainer = document.getElementById('sessionsContainer');
const openOptionsButton = document.getElementById('openOptions');

// DOM Elements
const livePreview = document.getElementById('livePreview');
const livePreviewContent = document.getElementById('livePreviewContent');

// Initialize popup
document.addEventListener('DOMContentLoaded', async () => {
  updateRecordingStatus();
  setupEventListeners();
  await updateLivePreview(); // Check for existing session
});

// Set up event listeners
function setupEventListeners() {
  startButton.addEventListener('click', startRecording);
  stopButton.addEventListener('click', stopRecording);
  viewSessionsButton.addEventListener('click', toggleSessionsList);
  openOptionsButton.addEventListener('click', openOptions);
  
  // Listen for storage changes to update live preview
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'local' && changes.sopData) {
      // Use requestAnimationFrame to prevent UI jank
      requestAnimationFrame(() => {
        // Debounce updates to prevent rapid refreshes
        if (state.updateTimeout) {
          clearTimeout(state.updateTimeout);
        }
        state.updateTimeout = setTimeout(() => {
          updateLivePreview();
        }, 250); // Wait 250ms before updating
      });
    }
  });
}

// Start recording
async function startRecording() {
  // Notify background script
  chrome.runtime.sendMessage({ type: 'START_SESSION' });
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Notify content script
  chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' });
  
  // Update UI
  startButton.disabled = true;
  stopButton.disabled = false;
  recordingStatus.textContent = 'Recording';
  recordingStatus.classList.add('recording');
  
  // Start duration timer
  recordingStartTime = Date.now();
  startDurationTimer();
}

// Stop recording
async function stopRecording() {
  // Notify background script
  chrome.runtime.sendMessage({ type: 'END_SESSION' });
  
  // Get current tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  // Notify content script
  chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
  
  // Update UI
  startButton.disabled = false;
  stopButton.disabled = true;
  recordingStatus.textContent = 'Not Recording';
  recordingStatus.classList.remove('recording');
  
  // Stop duration timer
  stopDurationTimer();
  
  // Refresh sessions list
  loadSessions();
}

// Update recording status
async function updateRecordingStatus() {
  const { sopData } = await chrome.storage.local.get('sopData');
  const isRecording = sopData?.currentSession != null;
  
  startButton.disabled = isRecording;
  stopButton.disabled = !isRecording;
  recordingStatus.textContent = isRecording ? 'Recording' : 'Not Recording';
  recordingStatus.classList.toggle('recording', isRecording);
  
  if (isRecording) {
    recordingStartTime = new Date(sopData.currentSession.startTime).getTime();
    startDurationTimer();
  }
}

// Timer functions
function startDurationTimer() {
  durationInterval = setInterval(updateDuration, 1000);
}

function stopDurationTimer() {
  if (durationInterval) {
    clearInterval(durationInterval);
    durationInterval = null;
  }
}

function updateDuration() {
  if (!recordingStartTime) return;
  
  const duration = Math.floor((Date.now() - recordingStartTime) / 1000);
  const minutes = Math.floor(duration / 60).toString().padStart(2, '0');
  const seconds = (duration % 60).toString().padStart(2, '0');
  durationElement.textContent = `${minutes}:${seconds}`;
}

// Session management
async function loadSessions() {
  chrome.runtime.sendMessage({ type: 'GET_SESSIONS' }, (response) => {
    displaySessions(response.sessions);
  });
}

function displaySessions(sessions) {
  sessionsContainer.innerHTML = '';
  
  if (!sessions || sessions.length === 0) {
    sessionsContainer.innerHTML = '<p class="no-sessions">No recorded sessions</p>';
    return;
  }
  
  sessions.forEach(session => {
    const sessionElement = document.createElement('div');
    sessionElement.className = 'session-item';
    
    const startTime = new Date(session.startTime).toLocaleString();
    const duration = calculateDuration(session.startTime, session.endTime);
    const stepCount = session.steps.reduce((count, step) => count + step.interactions.length, 0);
    
    // Create session info
    const sessionInfo = document.createElement('div');
    sessionInfo.className = 'session-info';
    sessionInfo.innerHTML = `
      <span class="session-time">${startTime}</span>
      <span class="session-duration">${duration}</span>
      <span class="step-count">${stepCount} steps</span>
    `;

    // Create action buttons
    const actionButtons = document.createElement('div');
    actionButtons.className = 'session-actions';
    
    const viewButton = document.createElement('button');
    viewButton.className = 'button small primary';
    viewButton.textContent = 'View SOP';
    viewButton.addEventListener('click', () => viewSOP(session.id));
    
    const downloadButton = document.createElement('button');
    downloadButton.className = 'button small';
    downloadButton.textContent = 'Download SOP';
    downloadButton.addEventListener('click', () => exportSOP(session.id));
    
    actionButtons.appendChild(viewButton);
    actionButtons.appendChild(downloadButton);

    // Add elements to session container
    sessionElement.appendChild(sessionInfo);
    sessionElement.appendChild(actionButtons);
    
    sessionsContainer.appendChild(sessionElement);
  });
}

function calculateDuration(startTime, endTime) {
  const duration = Math.floor((new Date(endTime) - new Date(startTime)) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  return `${minutes}m ${seconds}s`;
}

// Toggle sessions list visibility
function toggleSessionsList() {
  sessionsList.classList.toggle('hidden');
  if (!sessionsList.classList.contains('hidden')) {
    loadSessions();
  }
}

// View SOP in new tab
function viewSOP(sessionId) {
  chrome.runtime.sendMessage({ type: 'VIEW_SOP', sessionId }, (response) => {
    if (response.success) {
      const blob = new Blob([response.content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      chrome.tabs.create({ url }, () => {
        // Cleanup URL after tab is created
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
    } else {
      console.error('Error viewing SOP:', response.error);
      alert('Failed to view SOP. Please try again.');
    }
  });
}

// Export SOP as downloadable file
function exportSOP(sessionId) {
  chrome.runtime.sendMessage({ type: 'EXPORT_SOP', sessionId }, (response) => {
    if (response.success) {
      // Create and trigger download
      const blob = new Blob([response.content], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = `SOP_${new Date().toISOString().split('T')[0]}.html`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      // Cleanup
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } else {
      console.error('Error exporting SOP:', response.error);
      alert('Failed to export SOP. Please try again.');
    }
  });
}

// Open options page
function openOptions() {
  chrome.runtime.openOptionsPage();
}

// Update step count periodically
setInterval(async () => {
  const { sopData } = await chrome.storage.local.get('sopData');
  if (sopData?.currentSession) {
    const stepCount = sopData.currentSession.steps.reduce(
      (count, step) => count + step.interactions.length,
      0
    );
    stepCountElement.textContent = stepCount;
  }
}, 1000);

// Live Preview Functions
async function updateLivePreview() {
  const { sopData } = await chrome.storage.local.get('sopData');
  const currentSession = sopData?.currentSession;

  if (!currentSession) {
    livePreview.classList.add('hidden');
    return;
  }

  // Show live preview
  livePreview.classList.remove('hidden');
  sessionsList.classList.add('hidden');

  // Update metadata
  const metadataSection = livePreviewContent.querySelector('.metadata');
  const startTime = new Date(currentSession.startTime).toLocaleString();
  const duration = Math.floor((Date.now() - new Date(currentSession.startTime)) / 1000);
  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  
  metadataSection.innerHTML = `
    <p>Started: ${startTime}</p>
    <p>Duration: ${minutes}m ${seconds}s</p>
    <p>Steps: ${currentSession.steps.reduce((count, step) => count + step.interactions.length, 0)}</p>
  `;

  // Process and display steps
  const stepsContainer = livePreviewContent.querySelector('.steps-container');
  stepsContainer.innerHTML = '';
  
  let stepNumber = 1;
  currentSession.steps.forEach(step => {
    step.interactions.forEach(interaction => {
      const stepElement = document.createElement('div');
      stepElement.className = 'step';
      
      // Get description using SOPGenerator's helper
      const description = getInteractionDescription(interaction);
      
      stepElement.innerHTML = `
        <div class="step-number">Step ${stepNumber++}</div>
        <div class="step-description">${description}</div>
      `;

      // Find and add screenshot if available
      if (currentSession.screenshots && currentSession.screenshots.length > 0) {
        const screenshot = findMatchingScreenshot(currentSession, interaction.timestamp);
        if (screenshot) {
          stepElement.innerHTML += `<img src="${screenshot}" alt="Step ${stepNumber - 1} screenshot">`;
        }
      }

      stepsContainer.appendChild(stepElement);
    });
  });

  // Scroll to bottom to show latest steps
  stepsContainer.scrollTop = stepsContainer.scrollHeight;
}

// Helper function to find matching screenshot
function findMatchingScreenshot(session, timestamp) {
  if (!session.screenshots || session.screenshots.length === 0) return null;
  
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
  
  return closestScreenshot ? closestScreenshot.dataUrl : null;
}

// Modify start recording to show live preview
async function startRecording() {
  // Existing start recording code
  chrome.runtime.sendMessage({ type: 'START_SESSION' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'START_RECORDING' });
  
  // Update UI
  startButton.disabled = true;
  stopButton.disabled = false;
  recordingStatus.textContent = 'Recording';
  recordingStatus.classList.add('recording');
  
  // Start duration timer
  recordingStartTime = Date.now();
  startDurationTimer();
  
  // Show live preview
  sessionsList.classList.add('hidden');
  await updateLivePreview();
}

// Modify stop recording to hide live preview
async function stopRecording() {
  // Existing stop recording code
  chrome.runtime.sendMessage({ type: 'END_SESSION' });
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  chrome.tabs.sendMessage(tab.id, { type: 'STOP_RECORDING' });
  
  // Update UI
  startButton.disabled = false;
  stopButton.disabled = true;
  recordingStatus.textContent = 'Not Recording';
  recordingStatus.classList.remove('recording');
  
  // Stop duration timer
  stopDurationTimer();
  
  // Hide live preview and show sessions list
  livePreview.classList.add('hidden');
  loadSessions();
  sessionsList.classList.remove('hidden');
}