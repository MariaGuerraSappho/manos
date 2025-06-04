class HandTracker {
    constructor() {
        this.videoElement = document.getElementById('webcam');
        this.canvasElement = document.getElementById('overlay');
        this.canvasCtx = this.canvasElement.getContext('2d');
        this.statusElement = document.getElementById('tracking-status');
        this.permissionPrompt = document.getElementById('video-permission');
        this.enableCameraButton = document.getElementById('enable-camera');
        this.gestureFeedbackElement = document.getElementById('gesture-feedback');
        
        this.hands = null;
        this.camera = null;
        this.landmarks = null;
        this.handPresent = false;
        
        // For derived parameters
        this.previousLandmarks = null;
        this.velocity = Array(21).fill().map(() => ({ x: 0, y: 0, z: 0 }));
        this.acceleration = Array(21).fill().map(() => ({ x: 0, y: 0, z: 0 }));
        
        // Smoothing parameters
        this.smoothingFactor = 0.7; // Higher value = more smoothing
        this.smoothedLandmarks = null;
        
        // Gesture recognition
        this.detectedGestures = {
            victory: false,
            thumbsUp: false
        };
        this.gestureTimers = {
            victory: null,
            thumbsUp: null
        };
        
        // Callbacks
        this.onHandUpdate = null;
        this.onGestureDetected = null;
    }
    
    async initialize() {
        // Setup MediaPipe Hands using the global variable
        this.hands = new window.Hands({
            locateFile: (file) => {
                return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
            }
        });
        
        this.hands.setOptions({
            maxNumHands: 1,
            modelComplexity: 1,
            minDetectionConfidence: 0.5,
            minTrackingConfidence: 0.5
        });
        
        this.hands.onResults(this.onResults.bind(this));
        
        // Set up camera permission button
        this.enableCameraButton.addEventListener('click', () => {
            this.requestCameraPermission();
        });
        
        // Try to start camera
        await this.requestCameraPermission();
        
        // Set up resize handler
        this.resizeCanvas();
        window.addEventListener('resize', this.resizeCanvas.bind(this));
    }
    
    async requestCameraPermission() {
        try {
            // Setup camera
            const cameraOptions = {
                onFrame: async () => {
                    await this.hands.send({ image: this.videoElement });
                },
                width: 640,
                height: 480
            };
            
            this.camera = new window.Camera(this.videoElement, cameraOptions);
            await this.camera.start();
            
            // Hide permission prompt
            this.permissionPrompt.classList.add('hidden');
            
            this.statusElement.textContent = 'Initialized';
            
            return true;
        } catch (error) {
            console.error('Error starting camera:', error);
            this.statusElement.textContent = 'Camera error';
            
            // Show permission prompt
            this.permissionPrompt.classList.remove('hidden');
            
            return false;
        }
    }
    
    resizeCanvas() {
        this.canvasElement.width = this.videoElement.clientWidth;
        this.canvasElement.height = this.videoElement.clientHeight;
    }
    
    onResults(results) {
        this.canvasCtx.save();
        this.canvasCtx.clearRect(0, 0, this.canvasElement.width, this.canvasElement.height);
        
        // Draw the video feed
        this.canvasCtx.drawImage(
            results.image, 0, 0, this.canvasElement.width, this.canvasElement.height);
        
        if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
            this.handPresent = true;
            this.statusElement.textContent = 'Hand detected';
            
            // Store raw landmarks
            this.landmarks = results.multiHandLandmarks[0];
            
            // Apply smoothing
            this.applySmoothing();
            
            // Calculate derived parameters
            this.calculateDerivedParameters();
            
            // Detect special gestures
            this.detectSpecialGestures();
            
            // Draw hand landmarks
            this.drawHand();
            
            // Call the callback with processed hand data
            if (this.onHandUpdate) {
                this.onHandUpdate(this.getHandData());
            }
        } else {
            this.handPresent = false;
            this.statusElement.textContent = 'No hand detected';
            this.landmarks = null;
            this.smoothedLandmarks = null;
            
            // Reset gesture states when hand is not present
            this.resetGestureStates();
            
            if (this.onHandUpdate) {
                this.onHandUpdate(null);
            }
        }
        
        this.canvasCtx.restore();
    }
    
    applySmoothing() {
        if (!this.smoothedLandmarks && this.landmarks) {
            // First detection, initialize with current landmarks
            this.smoothedLandmarks = JSON.parse(JSON.stringify(this.landmarks));
        } else if (this.landmarks && this.smoothedLandmarks) {
            // Apply exponential smoothing
            for (let i = 0; i < this.landmarks.length; i++) {
                this.smoothedLandmarks[i].x = this.smoothingFactor * this.smoothedLandmarks[i].x + 
                                             (1 - this.smoothingFactor) * this.landmarks[i].x;
                this.smoothedLandmarks[i].y = this.smoothingFactor * this.smoothedLandmarks[i].y + 
                                             (1 - this.smoothingFactor) * this.landmarks[i].y;
                this.smoothedLandmarks[i].z = this.smoothingFactor * this.smoothedLandmarks[i].z + 
                                             (1 - this.smoothingFactor) * this.landmarks[i].z;
            }
        }
    }
    
    calculateDerivedParameters() {
        if (!this.smoothedLandmarks || !this.previousLandmarks) {
            this.previousLandmarks = JSON.parse(JSON.stringify(this.smoothedLandmarks));
            return;
        }
        
        // Calculate velocity and acceleration
        for (let i = 0; i < this.smoothedLandmarks.length; i++) {
            // Velocity (current - previous)
            const vx = this.smoothedLandmarks[i].x - this.previousLandmarks[i].x;
            const vy = this.smoothedLandmarks[i].y - this.previousLandmarks[i].y;
            const vz = this.smoothedLandmarks[i].z - this.previousLandmarks[i].z;
            
            // Acceleration (current velocity - previous velocity)
            const ax = vx - this.velocity[i].x;
            const ay = vy - this.velocity[i].y;
            const az = vz - this.velocity[i].z;
            
            this.velocity[i] = { x: vx, y: vy, z: vz };
            this.acceleration[i] = { x: ax, y: ay, z: az };
        }
        
        // Store current landmarks for next frame
        this.previousLandmarks = JSON.parse(JSON.stringify(this.smoothedLandmarks));
    }
    
    detectSpecialGestures() {
        // All special gestures have been disabled as requested
        // Keeping this method for possible future use
    }
    
    resetGestureStates() {
        this.detectedGestures.victory = false;
        this.detectedGestures.thumbsUp = false;
        
        // Clear any active timers
        if (this.gestureTimers.victory) {
            clearTimeout(this.gestureTimers.victory);
            this.gestureTimers.victory = null;
        }
        
        if (this.gestureTimers.thumbsUp) {
            clearTimeout(this.gestureTimers.thumbsUp);
            this.gestureTimers.thumbsUp = null;
        }
    }
    
    showGestureFeedback(message) {
        // Display gesture feedback on the screen
        if (!this.gestureFeedbackElement) return;
        
        this.gestureFeedbackElement.textContent = message;
        this.gestureFeedbackElement.classList.add('active');
        
        // Clear after a few seconds
        setTimeout(() => {
            this.gestureFeedbackElement.classList.remove('active');
        }, 3000);
    }
    
    drawHand() {
        if (!this.smoothedLandmarks) return;
        
        // Draw landmarks
        this.canvasCtx.fillStyle = 'rgba(255, 105, 180, 0.8)';
        for (const landmark of this.smoothedLandmarks) {
            const x = landmark.x * this.canvasElement.width;
            const y = landmark.y * this.canvasElement.height;
            
            this.canvasCtx.beginPath();
            this.canvasCtx.arc(x, y, 5, 0, 2 * Math.PI);
            this.canvasCtx.fill();
        }
        
        // Draw connections
        this.canvasCtx.strokeStyle = 'rgba(255, 182, 193, 0.8)';
        this.canvasCtx.lineWidth = 3;
        
        // Define connections (finger joints)
        const connections = [
            // Thumb
            [0, 1], [1, 2], [2, 3], [3, 4],
            // Index finger
            [0, 5], [5, 6], [6, 7], [7, 8],
            // Middle finger
            [0, 9], [9, 10], [10, 11], [11, 12],
            // Ring finger
            [0, 13], [13, 14], [14, 15], [15, 16],
            // Pinky
            [0, 17], [17, 18], [18, 19], [19, 20],
            // Palm
            [0, 5], [5, 9], [9, 13], [13, 17]
        ];
        
        for (const [index1, index2] of connections) {
            const start = this.smoothedLandmarks[index1];
            const end = this.smoothedLandmarks[index2];
            
            this.canvasCtx.beginPath();
            this.canvasCtx.moveTo(start.x * this.canvasElement.width, start.y * this.canvasElement.height);
            this.canvasCtx.lineTo(end.x * this.canvasElement.width, end.y * this.canvasElement.height);
            this.canvasCtx.stroke();
        }
    }
    
    getHandData() {
        if (!this.smoothedLandmarks) return null;
        
        // Calculate hand parameters
        const wrist = this.smoothedLandmarks[0];
        const indexFinger = this.smoothedLandmarks[8];
        const pinky = this.smoothedLandmarks[20];
        
        // Calculate hand height (normalized y position)
        const handHeight = 1 - wrist.y; // Closer to top = higher value
        
        // Calculate finger spread (distance between index finger and pinky)
        const fingerSpread = Math.sqrt(
            Math.pow(indexFinger.x - pinky.x, 2) + 
            Math.pow(indexFinger.y - pinky.y, 2)
        );
        
        // Calculate proximity (hand size/distance from camera)
        // Larger value means closer to camera
        const handSize = Math.sqrt(
            Math.pow(this.smoothedLandmarks[5].x - this.smoothedLandmarks[17].x, 2) + 
            Math.pow(this.smoothedLandmarks[5].y - this.smoothedLandmarks[17].y, 2)
        );
        
        // Enhanced proximity calculation for better volume control
        // Use more linear scaling with soft limits for more predictable response
        const rawProximity = handSize * 5;
        // Apply gentler scaling for smoother response
        // Using a sigmoid-like curve for smooth transitions at extremes
        const proximity = 1 / (1 + Math.exp(-6 * (rawProximity - 0.5)));
        
        // Calculate finger curl by comparing fingertips to palm
        const thumbCurl = this.calculateFingerCurl(1, 2, 3, 4);
        const indexCurl = this.calculateFingerCurl(5, 6, 7, 8);
        const middleCurl = this.calculateFingerCurl(9, 10, 11, 12);
        const ringCurl = this.calculateFingerCurl(13, 14, 15, 16);
        
        // Calculate overall curl (average of all fingers except pinky)
        const overallCurl = (thumbCurl + indexCurl + middleCurl + ringCurl) / 4;
        
        // Calculate hand velocity (wrist point)
        const handVelocity = Math.sqrt(
            Math.pow(this.velocity[0].x, 2) + 
            Math.pow(this.velocity[0].y, 2) + 
            Math.pow(this.velocity[0].z, 2)
        );
        
        // Hand position in camera frame (x, y coordinates)
        const positionX = wrist.x; // 0 = left edge, 1 = right edge
        const positionY = wrist.y; // 0 = top edge, 1 = bottom edge
        
        // Detect simple gestures
        const isOpen = overallCurl < 0.3;
        const isClosed = overallCurl > 0.7;
        
        // Detect special gestures
        const isVictory = indexCurl < 0.3 && middleCurl < 0.3 && ringCurl > 0.6 && thumbCurl > 0.4;
        const isThumbsUp = thumbCurl < 0.3 && indexCurl > 0.6 && middleCurl > 0.6 && ringCurl > 0.6;
        
        return {
            landmarks: this.smoothedLandmarks,
            height: handHeight,
            fingerSpread,
            positionX,
            positionY,
            proximity,
            curl: {
                thumb: thumbCurl,
                index: indexCurl,
                middle: middleCurl,
                ring: ringCurl,
                overall: overallCurl
            },
            velocity: handVelocity,
            gesture: {
                isOpen,
                isClosed,
                isVictory,
                isThumbsUp
            }
        };
    }
    
    calculateFingerCurl(baseIndex, joint1, joint2, tipIndex) {
        if (!this.smoothedLandmarks) return 0;
        
        const base = this.smoothedLandmarks[baseIndex];
        const tip = this.smoothedLandmarks[tipIndex];
        
        // Calculate the straight-line distance from base to tip
        const straightDistance = Math.sqrt(
            Math.pow(tip.x - base.x, 2) + 
            Math.pow(tip.y - base.y, 2) + 
            Math.pow(tip.z - base.z, 2)
        );
        
        // Calculate the full finger length through all joints
        const joint1Point = this.smoothedLandmarks[joint1];
        const joint2Point = this.smoothedLandmarks[joint2];
        
        const segment1 = Math.sqrt(
            Math.pow(joint1Point.x - base.x, 2) + 
            Math.pow(joint1Point.y - base.y, 2) + 
            Math.pow(joint1Point.z - base.z, 2)
        );
        
        const segment2 = Math.sqrt(
            Math.pow(joint2Point.x - joint1Point.x, 2) + 
            Math.pow(joint2Point.y - joint1Point.y, 2) + 
            Math.pow(joint2Point.z - joint2Point.z, 2)
        );
        
        const segment3 = Math.sqrt(
            Math.pow(tip.x - joint2Point.x, 2) + 
            Math.pow(tip.y - joint2Point.y, 2) + 
            Math.pow(tip.z - joint2Point.z, 2)
        );
        
        const fullLength = segment1 + segment2 + segment3;
        
        // Curl is the ratio of how much the finger is curled
        // 0 = straight, 1 = fully curled
        return 1 - (straightDistance / fullLength);
    }
    
    setHandUpdateCallback(callback) {
        this.onHandUpdate = callback;
    }
    
    setGestureDetectedCallback(callback) {
        this.onGestureDetected = callback;
    }
}

export default HandTracker;