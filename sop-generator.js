// SOP Generation and Export functionality

class SOPGenerator {
  static async generateSOP(session) {
    const steps = this.processSteps(session.steps);
    return this.createSOPDocument(steps, session);
  }

  static processSteps(rawSteps) {
    const processedSteps = [];
    let stepNumber = 1;

    rawSteps.forEach(step => {
      step.interactions.forEach(interaction => {
        switch (interaction.type) {
          case "mouse_click":
            let description = '';
            const clickType = interaction.clickType || 'left click';
            if (interaction.element === 'a' && interaction.href) {
              description = `${clickType} on link "${interaction.text || interaction.href}"`;
            } else if (interaction.element === 'button') {
              description = `${clickType} on button "${interaction.text || interaction.ariaLabel || 'Unnamed button'}"`;
            } else if (interaction.element === 'input') {
              description = `${clickType} on ${interaction.type || 'input'} field "${interaction.placeholder || interaction.name || interaction.ariaLabel || 'Unnamed input'}"`;
            } else if (interaction.role) {
              description = `${clickType} on ${interaction.role} "${interaction.text || interaction.ariaLabel || 'Unnamed element'}"`;
            } else {
              description = `${clickType} on ${interaction.element}${interaction.text ? ` "${interaction.text}"` : ''}`;
            }
            
            processedSteps.push({
              number: stepNumber++,
              description: description,
              element: interaction.element,
              coordinates: `(${interaction.x}, ${interaction.y})`,
              screenshot: interaction.screenshot
            });
            break;
          case "text_input":
            let inputDescription = '';
            const fieldName = interaction.label || interaction.ariaLabel || interaction.placeholder || interaction.name || 'field';
            
            if (interaction.inputType === 'textarea') {
              inputDescription = `Type in ${fieldName} textarea: "${interaction.text}"`;
            } else {
              inputDescription = `Type "${interaction.text}" in ${interaction.inputType} field "${fieldName}"`;
            }
            
            processedSteps.push({
              number: stepNumber++,
              description: inputDescription,
              element: interaction.element,
              inputType: interaction.inputType,
              fieldName: fieldName,
              screenshot: interaction.screenshot
            });
            break;
          case "navigation":
            processedSteps.push({
              number: stepNumber++,
              description: `Navigate to page: "${interaction.title}"`,
              element: 'navigation',
              screenshot: interaction.screenshot
            });
            break;
        }
      });
    });

    return processedSteps;
  }

  static createSOPDocument(steps, session) {
    const title = `Standard Operating Procedure - ${new Date(session.startTime).toLocaleDateString()}`;
    
    let html = `
      <!DOCTYPE html>
      <html>
      <head>
        <title>${title}</title>
        <style>
          body {
            font-family: Arial, sans-serif;
            line-height: 1.6;
            max-width: 800px;
            margin: 0 auto;
            padding: 20px;
          }
          .sop-header {
            background: #f5f5f5;
            padding: 20px;
            border-radius: 5px;
            margin-bottom: 30px;
          }
          .step {
            margin-bottom: 30px;
            padding: 15px;
            border: 1px solid #eee;
            border-radius: 5px;
          }
          .step:hover {
            background: #f9f9f9;
          }
          .step-number {
            font-weight: bold;
            color: #4a90e2;
          }
          .step-details {
            color: #666;
            font-size: 0.9em;
            margin-top: 5px;
          }
          .screenshot {
            max-width: 100%;
            margin-top: 10px;
            border: 1px solid #ddd;
            border-radius: 3px;
          }
          .metadata {
            color: #666;
            font-size: 0.8em;
            margin-top: 5px;
          }
        </style>
      </head>
      <body>
        <div class="sop-header">
          <h1>${title}</h1>
          <div class="metadata">
            <p>Created: ${new Date(session.startTime).toLocaleString()}</p>
            <p>Duration: ${this.calculateDuration(session.startTime, session.endTime)}</p>
          </div>
        </div>
        
        <div class="steps-container">
    `;

    steps.forEach(step => {
      html += `
        <div class="step">
          <div class="step-number">Step ${step.number}</div>
          <div class="step-description">${step.description}</div>
          <img src="${step.screenshot}" class="screenshot" alt="Step ${step.number} screenshot">
        </div>
      `;
    });

    html += `
        </div>
      </body>
      </html>
    `;

    return html;
  }

  static calculateDuration(startTime, endTime) {
    const duration = Math.floor((new Date(endTime) - new Date(startTime)) / 1000);
    const minutes = Math.floor(duration / 60);
    const seconds = duration % 60;
    return `${minutes} minutes, ${seconds} seconds`;
  }

  static async exportSOP(sessionId) {
    try {
      const { sopData } = await chrome.storage.local.get('sopData');
      const session = sopData.sessions.find(s => s.id === sessionId);
      
      if (!session) {
        throw new Error('Session not found');
      }

      const sopContent = await this.generateSOP(session);
      
      // Create a blob and download link
      const blob = new Blob([sopContent], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      
      // Create and trigger download
      const downloadLink = document.createElement('a');
      downloadLink.href = url;
      downloadLink.download = `SOP_${new Date(session.startTime).toISOString().split('T')[0]}.html`;
      document.body.appendChild(downloadLink);
      downloadLink.click();
      document.body.removeChild(downloadLink);
      
      // Cleanup
      setTimeout(() => URL.revokeObjectURL(url), 100);
      
      return true;
    } catch (error) {
      console.error('Error exporting SOP:', error);
      return false;
    }
  }
}