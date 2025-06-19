class JutsuExtension {
  constructor() {
    this.intervalIds = [];
    this.btnSkipIntroCanBeClick = true;
    this.fullScreenBtnCanBeClick = true;
    this.config = {};
    this.ws = null;
    this.isHost = false;
    this.roomId = null;
    this.clientId = null;
    this.connectedUsers = new Set();
    this.isSeeking = false;
    this.lastSyncTime = 0;
    this.syncInterval = null;
    this.isReconnecting = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.videoEventListeners = [];
    this.urlMonitorInterval = null;
    this.loadRoomState();

    // Add message listener for popup communication
    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
      if (request.action === 'toggleRoomControls') {
        const existingControls = document.querySelector('.room-controls-container');
        if (existingControls) {
          if (existingControls.style.display === 'none') {
            existingControls.style.display = 'block';
          } else {
            existingControls.style.display = 'none';
          }
        } else {
          this.createSyncControls();
          const newControls = document.querySelector('.room-controls-container');
          if (newControls) {
            newControls.style.display = 'block';
          }
        }
      }
      if (request.action === 'getRoomControlsState') {
        const existingControls = document.querySelector('.room-controls-container');
        let isVisible = false;
        if (existingControls && existingControls.style.display !== 'none') {
          isVisible = true;
        }
        sendResponse({ visible: isVisible });
      }
    });
  }

  loadRoomState() {
    try {
      const savedState = localStorage.getItem('jutsuRoomState');
      if (savedState) {
        const state = JSON.parse(savedState);
        this.roomId = state.roomId;
        this.isHost = state.isHost;
        this.clientId = state.clientId;
        console.log('Loaded room state:', state);
      }
    } catch (error) {
      console.error('Error loading room state:', error);
      this.clearRoomState();
    }
  }

  saveRoomState() {
    try {
      const state = {
        roomId: this.roomId,
        isHost: this.isHost,
        clientId: this.clientId,
      };
      localStorage.setItem('jutsuRoomState', JSON.stringify(state));
      console.log('Saved room state:', state);
    } catch (error) {
      console.error('Error saving room state:', error);
    }
  }

  clearRoomState() {
    try {
      localStorage.removeItem('jutsuRoomState');
      this.roomId = null;
      this.isHost = false;
      this.clientId = null;
      this.connectedUsers.clear();
      console.log('Cleared room state');
    } catch (error) {
      console.error('Error clearing room state:', error);
    }
  }

  async init() {
    window.addEventListener("load", async () => {
      if (this.workOnThisPage(window.location.href)) {
        this.config = await this.storage();

        chrome.storage.onChanged.addListener(async (changes, namespace) => {
          this.config = await this.storage();
          this.main();
        });

        if (!this.config.extensionEnabled) {
          this.disableExtension();
          return;
        }

        this.checkVideo();
        this.initSync();
      }
    });
  }

  async storage() {
    const DefaultConfig = {
      extensionEnabled: true,
      nextSeriesBeforeEnd: true,
      nextSeriesAfterEnd: false,
      skipIntro: true,
      clickToFullScreen: false,
      videoFromStart: false,
    };

    return new Promise((resolve, reject) => {
      chrome.storage.local.get("jutsuExtensionConfig", async (result) => {
        if (result.jutsuExtensionConfig === undefined) {
          await new Promise((resolve) => {
            chrome.storage.local.set({ jutsuExtensionConfig: DefaultConfig }, resolve);
          });
          resolve(DefaultConfig);
        } else {
          resolve(result.jutsuExtensionConfig);
        }
      });
    });
  }

  disableExtension() {
    const div = document.querySelector(".extension-overlay-div");
    if (div) {
      div.style.display = "none";
    }
    this.clearAllIntervals();
  }

  playVideo(video) {
    video.play();
  }

  checkVideo(callback = null) {
    const checkVideoElemOnPage = setInterval(() => {
      const video = document.getElementById("my-player_html5_api");
      if (video) {
        clearInterval(checkVideoElemOnPage);
        this.playVideo(video);
        this.checkForFullScreenButton();
        if (this.config.videoFromStart) {
          this.videoFromStart(video);
        }
        // Execută callback-ul dacă există
        if (callback) {
          callback();
        }
      }
    }, 100);
  }

  checkForFullScreenButton() {
    const checkForFullScreenButtonInterval = setInterval(() => {
      const fullScreenButton = document.querySelector(".vjs-fullscreen-control");
      if (fullScreenButton) {
        clearInterval(checkForFullScreenButtonInterval);
        this.setupFullScreenButton(fullScreenButton);
        this.main();
      }
    }, 100);
  }

  setupFullScreenButton(fullScreenButton) {
    fullScreenButton.addEventListener('click', () => {
      document.getElementById("my-player_html5_api").focus();
    });

    document.addEventListener('keydown', (event) => {
      if (event.code === "KeyF") {
        const message = document.querySelector('#message');
        const search = document.querySelector('input[type="text"][name="ystext"]');
        if (message !== document.activeElement && search !== document.activeElement) {
          this.goFullScreen();
        }
      }
    });
  }

  goFullScreen() {
    const fullScreenControl = document.querySelector(".vjs-fullscreen-control");
    fullScreenControl.click();
  }

  createOverlayBtn(bool) {
    const div = document.querySelector(".extension-overlay-div");
    if (!div) {
      if (!bool) {
        return;
      }
  
      const overlayDiv = document.createElement("div");
      overlayDiv.classList.add("extension-overlay-div");
      document.body.appendChild(overlayDiv);
  
      const fullScreenBtn = document.createElement("button");
      fullScreenBtn.classList.add("extension-overlay-button");
      fullScreenBtn.textContent = "Нажми на любую клавишу для полноэкранного режима";
      overlayDiv.appendChild(fullScreenBtn);
  
      const exitBtn = document.createElement("button");
      exitBtn.classList.add("extension-overlay-exit-button");
      exitBtn.textContent = "Exit";
      overlayDiv.appendChild(exitBtn);
  
      const closeOverlay = () => {
        overlayDiv.style.display = "none";
        this.fullScreenBtnCanBeClick = false;
        document.removeEventListener('fullscreenchange', closeOverlay);
        document.removeEventListener('keydown', handleKeyPress);
        document.getElementById("my-player_html5_api").focus();
      };

      const handleKeyPress = (event) => {
        if (event.code !== "Escape") {
          overlayDiv.style.display = "none";
          const fullScreenControl = document.querySelector(".vjs-fullscreen-control");
          fullScreenControl.classList.remove("vjs-hidden");
          fullScreenControl.click();
          this.fullScreenBtnCanBeClick = false;
          document.removeEventListener('fullscreenchange', closeOverlay);
          document.removeEventListener('keydown', handleKeyPress);
        }
      };
  
      document.addEventListener('fullscreenchange', closeOverlay);
      document.addEventListener('keydown', handleKeyPress);
  
      fullScreenBtn.onclick = () => {
        overlayDiv.style.display = "none";
        const fullScreenControl = document.querySelector(".vjs-fullscreen-control");
        fullScreenControl.classList.remove("vjs-hidden");
        fullScreenControl.click();
        this.fullScreenBtnCanBeClick = false;
        document.removeEventListener('fullscreenchange', closeOverlay);
        document.removeEventListener('keydown', handleKeyPress);
      };
  
      exitBtn.onclick = closeOverlay;
    } else {
      div.remove();
      this.createOverlayBtn(bool);
    }
  }
  
  

  workOnThisPage(websitePage) {
    return websitePage.includes("episode-") || websitePage.includes("film-");
  }

  clearAllIntervals() {
    for (const intervalId of this.intervalIds) {
      clearInterval(intervalId);
    }
    this.intervalIds = [];
  }

  videoFromStart(video) {
    const checkVideoTimeNotZero = setInterval(() => {
      if(video.currentTime > 0){
        video.currentTime = 0.2;
        clearInterval(checkVideoTimeNotZero);
      }
    }, 1000);
  }

  nextSeriesBeforeEnd(nextSerBtn) {
    const checkVideoEnded = setInterval(() => {
      if (document.getElementById("my-player_html5_api").ended === true || nextSerBtn.classList.contains("vjs-hidden") !== true) {
        clearInterval(checkVideoEnded);
        nextSerBtn.click();
      }
    }, 1000);
    this.intervalIds.push(checkVideoEnded);
  }

  nextSeriesAfterEnd(nextSerBtn) {
    const checkVideoEnded = setInterval(() => {
      if (document.getElementById("my-player_html5_api").ended === true) {
        clearInterval(checkVideoEnded);
        nextSerBtn.click();
      }
    }, 1000);
    this.intervalIds.push(checkVideoEnded);
  }

  // skipIntroOneTime(skipIntroBtn) {
  //   const checkSkipIntroBtnVisible = setInterval(() => {
  //     if (skipIntroBtn.classList.contains("vjs-hidden") !== true) {
  //       clearInterval(checkSkipIntroBtnVisible);
  //       skipIntroBtn.click();
  //     }
  //   }, 1000);
  //   this.intervalIds.push(checkSkipIntroBtnVisible);
  // }

  skipIntro(skipIntroBtn) {
    const checkSkipIntroBtnVisible = setInterval(() => {
      if (skipIntroBtn.classList.contains("vjs-hidden") !== true) {
        skipIntroBtn.click();
      }
    }, 1000);
    this.intervalIds.push(checkSkipIntroBtnVisible);
  }

    initSync() {
    if (this.ws) {
        try {
            this.ws.close();
        } catch (error) {
            console.error('Error closing existing connection:', error);
        }
    }

    // Detectează environment-ul
    const isProduction = window.location.protocol === 'https:' || 
                        window.location.hostname !== 'localhost';
    
    const wsUrl = 'wss://jut-su-vip.onrender.com/';

        try {
        this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        console.log('Connected to sync server');
        this.reconnectAttempts = 0;
        this.createSyncControls();
        
        if (this.roomId) {
          console.log('Reconnecting to room:', this.roomId);
          this.isReconnecting = true;
          if (this.isHost) {
            this.ws.send(JSON.stringify({
              type: 'create_room',
              roomId: this.roomId,
              url: window.location.href
            }));
          } else {
            this.ws.send(JSON.stringify({
              type: 'join_room',
              roomId: this.roomId
            }));
            // Pentru member după refresh, inițializează sincronizarea
            setTimeout(() => {
              this.checkVideo(() => {
                this.setupVideoSync();
                this.isReconnecting = false;
              });
            }, 500);
          }
          // Pentru host după refresh, inițializează sincronizarea
          if (this.isHost) {
            setTimeout(() => {
              this.checkVideo(() => {
                this.setupVideoSync();
                this.isReconnecting = false;
              });
            }, 500);
          } else {
            this.isReconnecting = false;
          }
        }
      };

      this.ws.onclose = () => {
        console.log('Connection closed');
        if (this.roomId && this.reconnectAttempts < this.maxReconnectAttempts) {
          this.reconnectAttempts++;
          console.log(`Attempting to reconnect (${this.reconnectAttempts}/${this.maxReconnectAttempts})...`);
          setTimeout(() => {
            this.initSync();
          }, 1000 * this.reconnectAttempts);
        } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
          console.log('Max reconnection attempts reached');
          this.clearRoomState();
          this.updateRoomInfo();
        }
      };

      this.ws.onerror = (error) => {
        console.error('WebSocket error:', error);
      };

      this.ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          console.log('Received message:', data);
          
          switch(data.type) {
            case 'room_created':
              this.clientId = data.clientId;
              this.saveRoomState();
              this.updateRoomInfo();
              
              // Dacă este o reconectare după refresh și suntem host
              if (data.isReconnection && this.isHost) {
                this.checkVideo(() => {
                  this.setupVideoSync();
                });
              }
              break;

            case 'user_reconnected':
              this.connectedUsers.add(data.clientId);
              this.updateRoomInfo();
              console.log('User reconnected:', data.clientId);
              break;

            case 'host_reconnected':
              console.log('Host reconnected');
              // Forțează o sincronizare pentru că host-ul s-a reconectat
              setTimeout(() => {
                const video = document.getElementById("my-player_html5_api");
                if (video && this.ws && this.ws.readyState === WebSocket.OPEN) {
                  this.ws.send(JSON.stringify({
                    type: 'sync',
                    action: video.paused ? 'pause' : 'play',
                    time: video.currentTime,
                    url: window.location.href
                  }));
                }
              }, 1000);
              break;

            case 'user_joined':
              this.connectedUsers.add(data.clientId);
              this.updateRoomInfo();
              // Dacă suntem member și ne-am reconectat, reinițializează sincronizarea
              if (!this.isHost && this.isReconnecting) {
                this.checkVideo(() => {
                  this.setupVideoSync();
                  this.isReconnecting = false;
                });
              }
              if (data.currentUrl !== window.location.href && !this.isReconnecting) {
                window.location.href = data.currentUrl;
              }
              break;

            case 'user_left':
              this.connectedUsers.delete(data.clientId);
              this.updateRoomInfo();
              break;

            case 'sync':
              this.handleSync(data);
              break;

            case 'url_change':
              console.log('URL change received:', data.url, 'Current URL:', window.location.href);
              if (data.url !== window.location.href) {
                console.log('Navigating to new URL:', data.url);
                // Setează flag-ul de reconectare
                this.isReconnecting = true;
                // Schimbă URL-ul
                window.location.href = data.url;
              } else if (data.url === window.location.href) {
                // Dacă suntem deja pe URL-ul corect, doar reinițializează sincronizarea
                this.reinitializeSync();
              }
              break;
          }
        } catch (error) {
          console.error('Error handling message:', error);
        }
      };
    } catch (error) {
      console.error('Error initializing WebSocket:', error);
    }
  }

  handleSync(data) {
    const video = document.getElementById("my-player_html5_api");
    if (!video || this.isSeeking) return;

    try {
      switch(data.action) {
        case 'play':
          if (video.paused) {
            video.play().catch(error => console.error('Error playing video:', error));
          }
          break;
        case 'pause':
          if (!video.paused) {
            video.pause();
          }
          break;
        case 'seek':
          if (Math.abs(video.currentTime - data.time) > 0.5) {
            video.currentTime = data.time;
            this.lastSyncTime = data.time;
          }
          break;
      }
    } catch (error) {
      console.error('Error handling sync:', error);
    }
  }

  createSyncControls() {
    const controlsDiv = document.createElement('div');
    controlsDiv.style.position = 'fixed';
    controlsDiv.style.top = '10px';
    controlsDiv.style.right = '10px';
    controlsDiv.style.zIndex = '9999';
    controlsDiv.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
    controlsDiv.style.padding = '10px';
    controlsDiv.style.borderRadius = '5px';
    controlsDiv.style.color = 'white';
    controlsDiv.style.minWidth = '200px';
    controlsDiv.style.display = 'none'; // Ascunde controalele implicit
    controlsDiv.classList.add('room-controls-container');

    // Room info section
    const roomInfo = document.createElement('div');
    roomInfo.id = 'room-info';
    roomInfo.style.marginBottom = '10px';
    controlsDiv.appendChild(roomInfo);

    // Controls container
    const controlsContainer = document.createElement('div');
    controlsContainer.id = 'room-controls';
    controlsContainer.style.display = this.roomId ? 'none' : 'block';
    controlsDiv.appendChild(controlsContainer);

    // Create room section
    const createRoomBtn = document.createElement('button');
    createRoomBtn.textContent = 'Create Room';
    createRoomBtn.style.marginRight = '10px';
    createRoomBtn.onclick = () => this.createRoom();

    // Join room section
    const joinRoomInput = document.createElement('input');
    joinRoomInput.type = 'text';
    joinRoomInput.placeholder = 'Room ID';
    joinRoomInput.style.marginRight = '10px';

    const joinRoomBtn = document.createElement('button');
    joinRoomBtn.textContent = 'Join Room';
    joinRoomBtn.onclick = () => this.joinRoom(joinRoomInput.value);

    // Leave room button
    const leaveRoomBtn = document.createElement('button');
    leaveRoomBtn.textContent = 'Leave Room';
    leaveRoomBtn.style.marginTop = '10px';
    leaveRoomBtn.style.width = '100%';
    leaveRoomBtn.style.backgroundColor = '#ff4444';
    leaveRoomBtn.style.color = 'white';
    leaveRoomBtn.style.border = 'none';
    leaveRoomBtn.style.padding = '5px';
    leaveRoomBtn.style.borderRadius = '3px';
    leaveRoomBtn.style.cursor = 'pointer';
    leaveRoomBtn.onclick = () => this.leaveRoom();

    controlsContainer.appendChild(createRoomBtn);
    controlsContainer.appendChild(joinRoomInput);
    controlsContainer.appendChild(joinRoomBtn);
    controlsDiv.appendChild(leaveRoomBtn);
    document.body.appendChild(controlsDiv);

    this.updateRoomInfo();
  }

  updateRoomInfo() {
    const roomInfo = document.getElementById('room-info');
    if (!roomInfo) return;

    let info = '';
    if (this.roomId) {
      info += `Room: ${this.roomId}<br>`;
      info += `Your ID: ${this.clientId}<br>`;
      info += `Connected Users: ${this.connectedUsers.size}<br>`;
      info += `Status: ${this.isHost ? 'Host' : 'Member'}`;
    } else {
      info = 'Not in a room';
    }
    roomInfo.innerHTML = info;
  }

  createRoom() {
    this.isHost = true;
    this.roomId = Math.random().toString(36).substring(7);
    this.ws.send(JSON.stringify({
      type: 'create_room',
      roomId: this.roomId,
      url: window.location.href
    }));
    this.saveRoomState();
    this.setupVideoSync();
    const controlsContainer = document.getElementById('room-controls');
    if (controlsContainer) {
      controlsContainer.style.display = 'none';
    }
  }

  joinRoom(roomId) {
    if (!roomId) {
      alert('Please enter a room ID');
      return;
    }
    this.roomId = roomId;
    this.isHost = false;
    this.ws.send(JSON.stringify({
      type: 'join_room',
      roomId: roomId
    }));
    this.saveRoomState();
    this.setupVideoSync();
    const controlsContainer = document.getElementById('room-controls');
    if (controlsContainer) {
      controlsContainer.style.display = 'none';
    }
  }

  leaveRoom() {
    if (this.ws && this.roomId) {
      this.ws.send(JSON.stringify({
        type: 'leave_room',
        roomId: this.roomId
      }));
    }
    this.clearRoomState();
    this.updateRoomInfo();
    const controlsContainer = document.getElementById('room-controls');
    if (controlsContainer) {
      controlsContainer.style.display = 'block';
    }
  }

  reinitializeSync() {
    if (this.roomId && this.ws && this.ws.readyState === WebSocket.OPEN) {
      // Curăță sincronizarea existentă
      if (this.syncInterval) {
        clearInterval(this.syncInterval);
      }
      
      // Verifică din nou video-ul și reinițializează sincronizarea
      this.checkVideo(() => {
        this.setupVideoSync();
      });
    }
  }

  setupVideoSync() {
    const video = document.getElementById("my-player_html5_api");
    if (!video) return;

    // Curăță evenimentele anterioare
    if (this.videoEventListeners) {
      this.videoEventListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
      });
    }
    this.videoEventListeners = [];

    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }

    this.syncInterval = setInterval(() => {
      if (video && !this.isSeeking) {
        const currentTime = video.currentTime;
        if (Math.abs(currentTime - this.lastSyncTime) > 0.5) {
          try {
            this.ws.send(JSON.stringify({
              type: 'sync',
              action: 'seek',
              time: currentTime,
              url: window.location.href
            }));
            this.lastSyncTime = currentTime;
          } catch (error) {
            console.error('Error sending sync:', error);
          }
        }
      }
    }, 1000);

    const setupVideoEvents = () => {
      const playHandler = () => {
        try {
          this.ws.send(JSON.stringify({
            type: 'sync',
            action: 'play',
            url: window.location.href
          }));
        } catch (error) {
          console.error('Error sending play sync:', error);
        }
      };

      const pauseHandler = () => {
        try {
          this.ws.send(JSON.stringify({
            type: 'sync',
            action: 'pause',
            url: window.location.href
          }));
        } catch (error) {
          console.error('Error sending pause sync:', error);
        }
      };

      const seekingHandler = () => {
        this.isSeeking = true;
      };

      const seekedHandler = () => {
        const currentTime = video.currentTime;
        if (Math.abs(currentTime - this.lastSyncTime) > 0.5) {
          try {
            this.ws.send(JSON.stringify({
              type: 'sync',
              action: 'seek',
              time: currentTime,
              url: window.location.href
            }));
            this.lastSyncTime = currentTime;
          } catch (error) {
            console.error('Error sending seek sync:', error);
          }
        }
        this.isSeeking = false;
      };

      video.addEventListener('play', playHandler);
      video.addEventListener('pause', pauseHandler);
      video.addEventListener('seeking', seekingHandler);
      video.addEventListener('seeked', seekedHandler);

      // Salvează referințele pentru curățare ulterioară
      this.videoEventListeners = [
        { element: video, event: 'play', handler: playHandler },
        { element: video, event: 'pause', handler: pauseHandler },
        { element: video, event: 'seeking', handler: seekingHandler },
        { element: video, event: 'seeked', handler: seekedHandler }
      ];
    };

    setupVideoEvents();

    // Monitor URL changes
    let lastUrl = window.location.href;
    if (this.urlMonitorInterval) {
      clearInterval(this.urlMonitorInterval);
    }

    this.urlMonitorInterval = setInterval(() => {
      if (lastUrl !== window.location.href) {
        lastUrl = window.location.href;
        this.isReconnecting = true;
        // Trimite URL change doar dacă suntem host
        if (this.isHost) {
          try {
            this.ws.send(JSON.stringify({
              type: 'url_change',
              url: window.location.href
            }));
            // Reconectează-te la cameră pe noul URL
            setTimeout(() => {
              this.ws.send(JSON.stringify({
                type: 'create_room',
                roomId: this.roomId,
                url: window.location.href
              }));
            }, 500);
          } catch (error) {
            console.error('Error sending URL change:', error);
          }
        }
        // Așteaptă ca noul video să fie disponibil și apoi reinițializează sincronizarea
        this.checkVideo(() => {
          this.setupVideoSync();
          setTimeout(() => {
            this.isReconnecting = false;
          }, 1000);
        });
      }
    }, 1000);
  }

  main() {
    this.clearAllIntervals();
    if (!this.config.extensionEnabled) {
      this.disableExtension();
      return;
    }

    const nextSerBtn = document.querySelector(".vjs-overlay-bottom-right");
    const skipIntroBtn = document.querySelector(".vjs-overlay-bottom-left");

    const { nextSeriesBeforeEnd, nextSeriesAfterEnd, skipIntro, clickToFullScreen } = this.config;

    if (this.fullScreenBtnCanBeClick) {
      this.createOverlayBtn(clickToFullScreen);
    }

    if (skipIntroBtn && skipIntro && this.btnSkipIntroCanBeClick) {
      this.skipIntro(skipIntroBtn);
    }

    if (nextSerBtn) {
      if (nextSeriesBeforeEnd){
        this.nextSeriesBeforeEnd(nextSerBtn);
      }else if (nextSeriesAfterEnd){
        this.nextSeriesAfterEnd(nextSerBtn);
      }
      
    }

  }

  // Adăugăm o metodă pentru curățarea resurselor
  cleanup() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
    }
    if (this.urlMonitorInterval) {
      clearInterval(this.urlMonitorInterval);
    }
    if (this.videoEventListeners) {
      this.videoEventListeners.forEach(({ element, event, handler }) => {
        element.removeEventListener(event, handler);
      });
      this.videoEventListeners = [];
    }
  }
}

const jutsuExtension = new JutsuExtension();
jutsuExtension.init();
