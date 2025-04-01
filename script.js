// Import the specific named export 'removeBackground'
import { removeBackground } from "https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.8/+esm";

// --- State Variables ---
let backgroundImage = null;
let subjectImage = null;
let selectedFile = null;
let originalObjectUrl = null;
let processedObjectUrl = null;
let textControls = []; // Array to store the indices of active text layers
let draggingTextIndex = null;
let dragStartX = 0;
let dragStartY = 0;
let dragStartOffsetX = 0;
let dragStartOffsetY = 0;
let textBoundingBoxes = [];
const referenceWidth = 1200; // Reference canvas size for scaling calculations
const referenceHeight = 900;
let bgImageAspect = null; // OPTIMIZATION: Store aspect ratio

// --- Dragging State for requestAnimationFrame ---
let isDragging = false;
let latestMouseX = 0;
let latestMouseY = 0;
let animationFrameRequestId = null;


// --- DOM Elements ---
const imageUploadInput = document.getElementById('imageUploadInput');
const uploadFileNameDisplay = document.getElementById('upload-file-name');
const startButton = document.getElementById('startButton');
const uploadInputArea = document.getElementById('upload-input-area');
const uploadLoadingArea = document.getElementById('upload-loading-area');
const uploadProgressText = document.getElementById('upload-progress-text');
const editorSection = document.getElementById('editor-section');
const imageEditor = document.getElementById('imageEditor');
const textControlsContainer = document.getElementById('textControlsContainer');
const textControlsPlaceholder = document.getElementById('textControlsPlaceholder');
const addTextButton = document.getElementById('addTextButton');
const canvasElement = document.getElementById('canvas');
let ctx = canvasElement ? canvasElement.getContext('2d') : console.error("Canvas element not found!");
const saveButton = document.getElementById('saveButton');
const resetButton = document.getElementById('resetButton');
const mobileMenuButton = document.getElementById('mobile-menu-button');
const mobileMenu = document.getElementById('mobile-menu');
const hamburgerIcon = document.getElementById('hamburger-icon');
const closeIcon = document.getElementById('close-icon');
const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');

// --- Utility Functions ---

// OPTIMIZATION: Debounce function to limit resize event handler frequency
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
};


// --- Event Listeners ---
if (imageUploadInput) {
    imageUploadInput.addEventListener('change', handleFileSelect);
}
if (startButton) {
    startButton.addEventListener('click', () => {
        if (selectedFile) {
            processImageClientSide(selectedFile);
        } else {
            alert("Please select an image file first.");
        }
    });
}
if (saveButton) saveButton.addEventListener('click', saveCanvas);
if (resetButton) resetButton.addEventListener('click', resetPage);
if (addTextButton) addTextButton.addEventListener('click', addTextControl);

// Mobile Menu Toggle
if (mobileMenuButton && mobileMenu && hamburgerIcon && closeIcon) {
    mobileMenuButton.addEventListener('click', () => {
        mobileMenu.classList.toggle('hidden');
        hamburgerIcon.classList.toggle('hidden');
        closeIcon.classList.toggle('hidden');
    });
}
// Close mobile menu on link click
mobileNavLinks.forEach(link => {
    link.addEventListener('click', () => {
        if (mobileMenu && !mobileMenu.classList.contains('hidden')) {
            mobileMenu.classList.add('hidden');
            if (hamburgerIcon) hamburgerIcon.classList.remove('hidden');
            if (closeIcon) closeIcon.classList.add('hidden');
        }
        // Allow default anchor behavior or smooth scroll handled later
    });
});

// --- Event Delegation for Dynamic Text Controls ---
if (textControlsContainer) {
    // Listen for changes that require immediate canvas update
    textControlsContainer.addEventListener('input', handleControlInput);
    // Listen for changes that might require structural UI updates (like toggles) or final value setting
    textControlsContainer.addEventListener('change', handleControlChange);
    // OPTIMIZATION: Use delegation for delete/toggle buttons
    textControlsContainer.addEventListener('click', handleControlAction);
}

// --- Canvas Event Listeners ---
if (canvasElement) {
    canvasElement.addEventListener('mousedown', startDrag);
    canvasElement.addEventListener('mousemove', drag); // Will use requestAnimationFrame
    canvasElement.addEventListener('mouseup', endDrag);
    canvasElement.addEventListener('mouseleave', endDrag); // Stop dragging if mouse leaves canvas
}

// --- Event Handlers ---

function handleFileSelect() {
    if (this.files && this.files[0]) {
        const file = this.files[0];
        // Basic validation
        if (!file.type.startsWith('image/')) {
            alert('Please select a valid image file (JPG, PNG, WEBP).');
            resetFileInput();
            return;
        }
        if (file.size > 10 * 1024 * 1024) { // 10MB Limit
            alert('File size exceeds 10MB limit.');
            resetFileInput();
            return;
        }
        // Update State & UI
        selectedFile = file;
        if (uploadFileNameDisplay) {
            uploadFileNameDisplay.textContent = selectedFile.name;
            uploadFileNameDisplay.className = 'font-medium text-indigo-300 mb-2 truncate block'; // Style for selected file
        }
        if (startButton) startButton.removeAttribute('disabled');
    } else { // No file selected or selection cancelled
        resetFileInput();
    }
}

function resetFileInput() {
    selectedFile = null;
    if (imageUploadInput) imageUploadInput.value = ''; // Clear the input
    if (uploadFileNameDisplay) {
        uploadFileNameDisplay.textContent = "Select your image file";
        uploadFileNameDisplay.className = 'opacity-70 mb-2';
    }
    if (startButton) startButton.setAttribute('disabled', '');
}

function handleControlInput(event) {
    const target = event.target;
    const textControlDiv = target.closest('.text-control');
    if (!textControlDiv) return; // Event didn't originate from a text control

    // Update canvas for real-time feedback on sliders, text input, color changes
    if (target.type === 'range' || target.type === 'text' || target.type === 'color') {
        if (target.type === 'range') {
            updateRangeValueDisplay(target); // Update the displayed value next to the slider
        }
        updateCanvas(); // Redraw immediately for these inputs
    }
}

function handleControlChange(event) {
    const target = event.target;
    const textControlDiv = target.closest('.text-control');
    if (!textControlDiv) return;

    const index = textControlDiv.dataset.textIndex;
    if (!index) return;

    // Handle toggles for sub-control visibility
    if (target.type === 'checkbox' && target.classList.contains('toggle-checkbox')) {
         const controlIdBase = target.id.replace(index, ''); // e.g., 'enableGradient'
         const subControlsDivId = `${controlIdBase.replace('enable', '').toLowerCase()}Controls${index}`; // e.g., 'gradientControls1'
         toggleSubControls(subControlsDivId, target.checked);
         // Also update canvas for blur toggle or if gradient/shadow is enabled/disabled
         updateCanvas();
    }
    // Handle changes in dropdowns (font, weight)
    else if (target.tagName === 'SELECT') {
        updateCanvas();
    }
}

// OPTIMIZATION: Handle delete/toggle via event delegation
function handleControlAction(event) {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const action = button.dataset.action;
    const textControlDiv = button.closest('.text-control');
    if (!textControlDiv) return;

    const index = textControlDiv.dataset.textIndex;
    if (!index) return;

    if (action === 'toggle-collapse') {
        toggleTextControlCollapse(index, button);
    } else if (action === 'delete-layer') {
        deleteTextControl(index);
    }
}


// Helper to update the text display next to a range slider
function updateRangeValueDisplay(sliderElement) {
    const displaySpan = sliderElement.parentElement.querySelector('.range-value-display'); // Find the span
    if (displaySpan) {
        const unit = sliderElement.dataset.unit || ''; // Get unit from data attribute
        const value = sliderElement.value;
        // Format opacity nicely, keep others as integers or with unit
        const displayValue = (unit === '' && !isNaN(parseFloat(value))) ? parseFloat(value).toFixed(1) : value;
        displaySpan.textContent = `${displayValue}${unit}`;
    }
}

// Helper to show/hide sub-control divs and enable/disable their inputs
function toggleSubControls(elementId, show) {
    const controlsDiv = document.getElementById(elementId);
    if (controlsDiv) {
        controlsDiv.classList.toggle('hidden', !show);
        // controlsDiv.classList.toggle('sub-controls', show); // Not strictly needed with 'hidden'
        const inputs = controlsDiv.querySelectorAll('input, select');
        inputs.forEach(input => {
            input.disabled = !show;
            // Update display for range sliders within the sub-controls when enabling
            if (show && input.type === 'range') {
                updateRangeValueDisplay(input);
            }
        });
    }
}


// --- Canvas Responsiveness ---
function resizeCanvas() {
    const canvasContainer = canvasElement?.parentElement?.parentElement; // Navigate up to the container div
    if (!canvasContainer || !canvasElement || !backgroundImage || !bgImageAspect) {
         // Ensure canvas element and background image are ready before resizing
        return;
    }

    // Calculate available width, considering padding
    const style = window.getComputedStyle(canvasContainer);
    const paddingX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight);
    const paddingY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom); // Consider vertical padding too
    const containerWidth = canvasContainer.clientWidth - paddingX;
    // Estimate available height (more complex in flex/grid, approximate based on parent)
    // Let's use viewport height minus top offset as a rough max height estimate, refine if needed
    const topOffset = canvasContainer.getBoundingClientRect().top + window.scrollY;
    const availableHeight = window.innerHeight - topOffset - paddingY - 30; // 30px buffer for buttons below

    // Determine canvas dimensions based on aspect ratio and container width/height
    const canvasAspect = referenceWidth / referenceHeight;
    let canvasWidth = containerWidth;
    let canvasHeight = canvasWidth / canvasAspect;

    // If calculated height is too much for the container/estimated available height, scale based on height instead
    if (canvasHeight > availableHeight && availableHeight > 50) { // Ensure positive height
         canvasHeight = availableHeight;
         canvasWidth = canvasHeight * canvasAspect;
    }
     // Ensure width doesn't exceed container width
    if (canvasWidth > containerWidth) {
         canvasWidth = containerWidth;
         canvasHeight = canvasWidth / canvasAspect;
    }


    // Set logical canvas size (drawing buffer) - Keep fixed for consistency
    canvasElement.width = referenceWidth;
    canvasElement.height = referenceHeight;

    // Set display size using CSS to fit container, prevent upscaling beyond logical size
    canvasElement.style.width = `${Math.max(50, Math.min(canvasWidth, referenceWidth))}px`; // Min width 50px
    canvasElement.style.height = `${Math.max(50 / canvasAspect, Math.min(canvasHeight, referenceHeight))}px`; // Min height based on aspect

    updateCanvas(); // Redraw content with new dimensions/scaling
}

// --- Text Dragging on Canvas (Optimized with requestAnimationFrame) ---

function getMousePos(canvas, evt) {
    const rect = canvas.getBoundingClientRect();
    // Calculate mouse position relative to the *scaled* canvas display size
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    return {
        x: (evt.clientX - rect.left) * scaleX,
        y: (evt.clientY - rect.top) * scaleY
    };
}

function startDrag(evt) {
    const mousePos = getMousePos(canvasElement, evt);
    // Check from top layer (last drawn) downwards
    for (let i = textBoundingBoxes.length - 1; i >= 0; i--) {
        const { index, aabb } = textBoundingBoxes[i];
        // Check if click is within the Axis-Aligned Bounding Box
        if (mousePos.x >= aabb.left && mousePos.x <= aabb.right && mousePos.y >= aabb.top && mousePos.y <= aabb.bottom) {

            // Ensure the control div still exists
            const textControl = document.querySelector(`.text-control[data-text-index="${index}"]`);
            if (!textControl) continue; // Skip if controls were removed

            draggingTextIndex = index;
            isDragging = true;

            const xOffsetSlider = textControl.querySelector(`#textXOffset${index}`);
            const yOffsetSlider = textControl.querySelector(`#textYOffset${index}`);

            // Store the starting offsets from the sliders
            dragStartOffsetX = parseFloat(xOffsetSlider.value);
            dragStartOffsetY = parseFloat(yOffsetSlider.value);

            // Store the initial mouse position relative to the canvas's logical coordinates
            dragStartX = mousePos.x;
            dragStartY = mousePos.y;

            // Update latest mouse position immediately
            latestMouseX = mousePos.x;
            latestMouseY = mousePos.y;

            canvasElement.style.cursor = 'grabbing';

            // Start the animation frame loop if not already running
            if (!animationFrameRequestId) {
                animationFrameRequestId = requestAnimationFrame(dragUpdateLoop);
            }
            break; // Only drag the topmost text layer found
        }
    }
}

function drag(evt) {
    // Only update the latest mouse position here
    if (isDragging) {
        const mousePos = getMousePos(canvasElement, evt);
        latestMouseX = mousePos.x;
        latestMouseY = mousePos.y;

        // The actual update happens in the animation frame loop
        if (!animationFrameRequestId) {
             animationFrameRequestId = requestAnimationFrame(dragUpdateLoop);
        }
    } else {
        // Check hover state when not dragging
        checkHover(evt);
    }
}

function dragUpdateLoop() {
    if (!isDragging || draggingTextIndex === null) {
        animationFrameRequestId = null; // Stop the loop if not dragging
        return;
    }

    // Calculate the difference in mouse position from the start (in logical canvas coordinates)
    const dx = latestMouseX - dragStartX;
    const dy = latestMouseY - dragStartY;

    // Calculate the new offsets based on the initial slider values and the mouse movement
    const newOffsetX = dragStartOffsetX + dx;
    const newOffsetY = dragStartOffsetY + dy;

    // Find the corresponding sliders and update their values
    const textControl = document.querySelector(`.text-control[data-text-index="${draggingTextIndex}"]`);
    if (textControl) { // Check if control still exists
        const xOffsetSlider = textControl.querySelector(`#textXOffset${draggingTextIndex}`);
        const yOffsetSlider = textControl.querySelector(`#textYOffset${draggingTextIndex}`);

        // Clamp values to slider min/max
        xOffsetSlider.value = Math.max(parseFloat(xOffsetSlider.min), Math.min(parseFloat(xOffsetSlider.max), newOffsetX));
        yOffsetSlider.value = Math.max(parseFloat(yOffsetSlider.min), Math.min(parseFloat(yOffsetSlider.max), newOffsetY));

        // Update the displayed value next to the sliders
        updateRangeValueDisplay(xOffsetSlider);
        updateRangeValueDisplay(yOffsetSlider);

        // Redraw the canvas
        updateCanvas();
    } else {
        // Control was likely deleted, stop dragging
        endDrag(); // Call endDrag to clean up state
    }


    // Request the next frame
    animationFrameRequestId = requestAnimationFrame(dragUpdateLoop);
}


function endDrag(evt) {
    if (isDragging) {
        isDragging = false;
        draggingTextIndex = null;
        // Cancel the animation frame loop
        if (animationFrameRequestId) {
            cancelAnimationFrame(animationFrameRequestId);
            animationFrameRequestId = null;
        }
         // No final update needed here, as rAF handles the last update
    }
    // Check hover state on mouse up/leave
    checkHover(evt);
}

function checkHover(evt) {
    if (!canvasElement) return; // Ensure canvas exists
    let hovering = false;
    if (evt && evt.clientX && !isDragging) { // Only check hover if not currently dragging
       const currentMousePos = getMousePos(canvasElement, evt);
       for (let i = textBoundingBoxes.length - 1; i >= 0; i--) {
           const { aabb } = textBoundingBoxes[i];
           if (currentMousePos.x >= aabb.left && currentMousePos.x <= aabb.right && currentMousePos.y >= aabb.top && currentMousePos.y <= aabb.bottom) {
               hovering = true;
               break;
           }
       }
    }
    canvasElement.style.cursor = hovering ? 'grab' : 'default';
}


// --- Core Functions ---

async function processImageClientSide(fileToProcess) {
    if (!fileToProcess || !uploadInputArea || !uploadLoadingArea || !editorSection || !uploadProgressText || !ctx) return;

    // UI updates for loading state
    uploadInputArea.classList.add('hidden');
    uploadLoadingArea.classList.remove('hidden');
    uploadLoadingArea.classList.add('flex', 'flex-col', 'items-center', 'justify-center');
    uploadProgressText.textContent = 'Preparing image...';
    if (startButton) startButton.setAttribute('disabled', '');
    if (addTextButton) addTextButton.disabled = true; // Disable add text during processing

    const config = {
        progress: (key, current, total) => {
            const progressPercentage = Math.round((current / total) * 100);
            let stage = "Processing";
            if (key.includes("fetch")) stage = "Downloading AI Model";
            else if (key.includes("init")) stage = "Initializing Engine";
            uploadProgressText.textContent = `${stage}... (${progressPercentage}%)`;
            // console.log(`Progress ${key}: ${current} of ${total} (${progressPercentage}%)`);
        },
         output: {
            format: "image/png", // Ensure PNG output for transparency
            quality: 0.9, // Adjust quality if needed, 0.9 is a good balance
        }
    };

    try {
        uploadProgressText.textContent = 'Removing background... (AI model may download)';
        console.time("backgroundRemoval");
        const processedBlob = await removeBackground(fileToProcess, config);
        console.timeEnd("backgroundRemoval");

        uploadProgressText.textContent = 'Loading images into editor...';

        // Clean up previous object URLs if they exist
        if (originalObjectUrl) URL.revokeObjectURL(originalObjectUrl);
        if (processedObjectUrl) URL.revokeObjectURL(processedObjectUrl);

        // Create Object URLs for the images
        originalObjectUrl = URL.createObjectURL(fileToProcess);
        processedObjectUrl = URL.createObjectURL(processedBlob);

        // Load images and wait for them
        const bgLoadPromise = new Promise((resolve, reject) => {
            backgroundImage = new Image();
            backgroundImage.onload = () => {
                bgImageAspect = backgroundImage.naturalWidth / backgroundImage.naturalHeight; // Store aspect ratio
                resolve();
            };
            backgroundImage.onerror = reject;
            backgroundImage.src = originalObjectUrl;
        });
        const subjectLoadPromise = new Promise((resolve, reject) => {
            subjectImage = new Image();
            subjectImage.onload = resolve;
            subjectImage.onerror = reject;
            subjectImage.src = processedObjectUrl;
        });

        await Promise.all([bgLoadPromise, subjectLoadPromise]);

        // UI updates for editor state
        uploadLoadingArea.classList.add('hidden'); // Hide loader
        editorSection.classList.remove('hidden'); // Show editor
        editorSection.classList.add('visible');   // Trigger fade-in animation
        if (addTextButton) addTextButton.disabled = false; // Enable add text button

        // Remove placeholder if it exists
        textControlsPlaceholder?.remove(); // Optional chaining

        // Add the first text layer automatically if none exist
        if (textControls.length === 0) {
            addTextControl(); // This will call updateCanvas
        }

        // Initial canvas size calculation and drawing
        // resizeCanvas calls updateCanvas internally
        resizeCanvas();

        // Scroll to the editor section
        editorSection.scrollIntoView({ behavior: 'smooth', block: 'start' });

    } catch (error) {
        console.error('Client-side background removal failed:', error);
        alert(`Failed to process image: ${error?.message || 'An unknown error occurred.'}\nPlease try a different image or check console for details.`);
        resetToUploadView(true); // Reset UI back to upload state
    } finally {
        // Ensure loader is hidden and start button is disabled after process
        uploadLoadingArea.classList.add('hidden');
        if (startButton) startButton.setAttribute('disabled', ''); // Keep start disabled until new file selected
    }
}

// Function to dynamically add a new set of text controls
function addTextControl() {
    if (!backgroundImage) { // Ensure image is loaded before adding text
        console.warn("Attempted to add text before image was processed.");
        // alert("Please upload and process an image first."); // Maybe too annoying
        return;
    }

    // Remove placeholder if it's still there
    document.getElementById('textControlsPlaceholder')?.remove();

    // Find the next available index for the text layer
    let newIndex = 1;
    while (textControls.includes(newIndex)) { newIndex++; }
    textControls.push(newIndex);
    textControls.sort((a, b) => a - b); // Keep indices sorted

    // Define CSS classes based on the reference style
    const inputClasses = "w-full px-3 py-2 mt-1 bg-gray-700 text-gray-300 border border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500 placeholder-gray-500";
    const selectClasses = "w-full px-3 py-2 mt-1 bg-gray-700 text-gray-300 border border-gray-600 rounded-lg focus:ring-indigo-500 focus:border-indigo-500"; // Use default browser arrow
    const rangeClasses = "w-full h-2 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-indigo-500";
    const colorClasses = "control-color h-10 w-full p-0 border border-gray-600 rounded-lg cursor-pointer bg-gray-700";

    // *** HTML TEMPLATE with data-action for buttons ***
    const controlHtml = `
        <div class="text-control bg-white/10 p-4 rounded-lg shadow border border-white/15 animate-scaleIn" data-text-index="${newIndex}">
            <div class="flex justify-between items-center mb-3 pb-2 border-b border-white/10">
                <h4 class="text-md font-semibold text-white">Text Layer ${newIndex}</h4>
                <div class="flex items-center space-x-1">
                    <button type="button" title="Collapse/Expand" data-action="toggle-collapse" class="text-indigo-300 hover:text-indigo-100 p-1 rounded hover:bg-white/10 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 chevron-icon transition-transform duration-300 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                    </button>
                    <button type="button" title="Delete Layer" data-action="delete-layer" class="text-pink-400 hover:text-pink-300 p-1 rounded hover:bg-white/10 transition">
                        <svg xmlns="http://www.w3.org/2000/svg" class="h-5 w-5 pointer-events-none" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                            <path stroke-linecap="round" stroke-linejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                    </button>
                </div>
            </div>

            <div id="textControlSet${newIndex}" class="space-y-4 text-control-content"> 
                <div>
                    <label for="textInput${newIndex}" class="block text-sm font-medium mb-1 text-gray-300">Text Content</label>
                    <input type="text" id="textInput${newIndex}" value="Your Text ${newIndex}" placeholder="Enter text" class="${inputClasses}">
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                         <label for="fontSelect${newIndex}" class="block text-sm font-medium mb-1 text-gray-300">Font Family</label>
                         <select id="fontSelect${newIndex}" class="${selectClasses}">
                            <option value="Poppins" selected>Poppins</option>
                            <option value="Montserrat">Montserrat</option>
                            <option value="Roboto">Roboto</option>
                            <option value="Open Sans">Open Sans</option>
                            <option value="Lato">Lato</option>
                            <option value="Oswald">Oswald</option>
                            <option value="Raleway">Raleway</option>
                            <option value="Merriweather">Merriweather</option>
                            <option value="Playfair Display">Playfair Display</option>
                            <option value="Anton">Anton</option>
                            <option value="Amatic SC">Amatic SC</option>
                         </select>
                    </div>
                    <div>
                         <label for="fontWeight${newIndex}" class="block text-sm font-medium mb-1 text-gray-300">Font Weight</label>
                         <select id="fontWeight${newIndex}" class="${selectClasses}">
                            <option value="300">Light</option> 
                            <option value="400" selected>Normal</option>
                            <option value="500">Medium</option>
                            <option value="600">Semi-Bold</option> 
                            <option value="700">Bold</option>
                            <option value="900">Black</option> 
                         </select>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3 items-end">
                    <div>
                        <label for="textSize${newIndex}" class="block text-sm font-medium mb-1 text-gray-300">Size</label>
                        <input type="range" id="textSize${newIndex}" min="10" max="350" value="100" class="${rangeClasses}" data-unit="px">
                        <span class="text-xs text-white/60 block text-right mt-1 range-value-display">100px</span>
                    </div>
                    <div>
                        <label for="textColor${newIndex}" class="block text-sm font-medium mb-1 text-gray-300">Color</label>
                        <input type="color" id="textColor${newIndex}" value="#FFFFFF" class="${colorClasses}">
                    </div>
                </div>

                 <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="textXOffset${newIndex}" class="block text-sm font-medium mb-1 text-gray-300">X Offset</label>
                        <input type="range" id="textXOffset${newIndex}" min="-${referenceWidth / 1.5}" max="${referenceWidth / 1.5}" value="0" step="1" class="${rangeClasses}" data-unit="px">
                        <span class="text-xs text-white/60 block text-right mt-1 range-value-display">0px</span>
                    </div>
                    <div>
                        <label for="textYOffset${newIndex}" class="block text-sm font-medium mb-1 text-gray-300">Y Offset</label>
                        <input type="range" id="textYOffset${newIndex}" min="-${referenceHeight / 1.5}" max="${referenceHeight / 1.5}" value="0" step="1" class="${rangeClasses}" data-unit="px">
                        <span class="text-xs text-white/60 block text-right mt-1 range-value-display">0px</span>
                    </div>
                </div>

                <div class="grid grid-cols-2 gap-3">
                    <div>
                        <label for="textRotation${newIndex}" class="block text-sm font-medium mb-1 text-gray-300">Rotation</label>
                        <input type="range" id="textRotation${newIndex}" min="-45" max="45" value="0" step="1" class="${rangeClasses}" data-unit="°">
                        <span class="text-xs text-white/60 block text-right mt-1 range-value-display">0°</span>
                    </div>
                    <div>
                        <label for="textOpacity${newIndex}" class="block text-sm font-medium mb-1 text-gray-300">Opacity</label>
                        <input type="range" id="textOpacity${newIndex}" min="0" max="1" step="0.05" value="1" class="${rangeClasses}" data-unit="">
                        <span class="text-xs text-white/60 block text-right mt-1 range-value-display">1.0</span>
                    </div>
                </div>

                 <div class="pt-3 mt-3 border-t border-white/10">
                     <h5 class="text-sm font-semibold mb-2 text-indigo-200">Effects</h5>

                     <div class="flex items-center justify-between mb-3">
                         <span class="text-sm font-medium text-gray-300">Text Blur</span>
                         <label class="relative inline-flex items-center cursor-pointer">
                             <input type="checkbox" id="blur${newIndex}" class="sr-only peer toggle-checkbox">
                             <div class="toggle-label w-11 h-6 bg-gray-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-400 transition duration-200 ease-in-out peer-checked:bg-indigo-600">
                                 <div class="toggle-dot absolute left-1 top-1 bg-white border-gray-300 border rounded-full h-4 w-4 transition-transform duration-200 ease-in-out"></div>
                             </div>
                         </label>
                     </div>

                     <div class="mb-3">
                         <div class="flex items-center justify-between mb-2">
                             <span class="text-sm font-medium text-gray-300">Color Gradient</span>
                             <label class="relative inline-flex items-center cursor-pointer">
                                 <input type="checkbox" id="enableGradient${newIndex}" class="sr-only peer toggle-checkbox">
                                 <div class="toggle-label w-11 h-6 bg-gray-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-400 transition duration-200 ease-in-out peer-checked:bg-indigo-600">
                                     <div class="toggle-dot absolute left-1 top-1 bg-white border-gray-300 border rounded-full h-4 w-4 transition-transform duration-200 ease-in-out"></div>
                                 </div>
                             </label>
                         </div>
                         <div id="gradientControls${newIndex}" class="hidden sub-controls space-y-2 pl-2 border-l-2 border-indigo-700/50 ml-1">
                             <label for="gradientColor${newIndex}" class="block text-xs font-medium text-gray-400">Gradient End Color</label>
                             <input type="color" id="gradientColor${newIndex}" value="#EC4899" class="${colorClasses} w-full" disabled>
                         </div>
                     </div>

                    <div>
                        <div class="flex items-center justify-between mb-2">
                            <span class="text-sm font-medium text-gray-300">Text Shadow</span>
                            <label class="relative inline-flex items-center cursor-pointer">
                                <input type="checkbox" id="enableShadow${newIndex}" class="sr-only peer toggle-checkbox">
                                <div class="toggle-label w-11 h-6 bg-gray-600 rounded-full peer peer-focus:ring-2 peer-focus:ring-indigo-400 transition duration-200 ease-in-out peer-checked:bg-indigo-600">
                                    <div class="toggle-dot absolute left-1 top-1 bg-white border-gray-300 border rounded-full h-4 w-4 transition-transform duration-200 ease-in-out"></div>
                                </div>
                            </label>
                        </div>
                        <div id="shadowControls${newIndex}" class="hidden sub-controls space-y-3 pl-2 border-l-2 border-indigo-700/50 ml-1">
                            <div>
                                <label for="shadowColor${newIndex}" class="block text-xs font-medium text-gray-400 mb-1">Shadow Color</label>
                                <input type="color" id="shadowColor${newIndex}" value="#000000" class="${colorClasses} w-full" disabled>
                            </div>
                            <div class="grid grid-cols-2 gap-3">
                                <div>
                                    <label for="shadowBlur${newIndex}" class="block text-xs font-medium text-gray-400 mb-1">Shadow Blur</label>
                                    <input type="range" id="shadowBlur${newIndex}" min="0" max="50" value="5" step="1" class="${rangeClasses}" data-unit="px" disabled>
                                    <span class="text-xs text-white/60 block text-right mt-1 range-value-display">5px</span>
                                </div>
                                <div>
                                    <label for="shadowOffset${newIndex}" class="block text-xs font-medium text-gray-400 mb-1">Shadow Offset</label>
                                    <input type="range" id="shadowOffset${newIndex}" min="-25" max="25" value="5" step="1" class="${rangeClasses}" data-unit="px" disabled>
                                    <span class="text-xs text-white/60 block text-right mt-1 range-value-display">5px</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    `;

    if (textControlsContainer) {
        textControlsContainer.insertAdjacentHTML('beforeend', controlHtml);
        const newControl = textControlsContainer.lastElementChild;

        // Initialize range slider displays for the new control
        newControl?.querySelectorAll('input[type="range"]').forEach(slider => {
            updateRangeValueDisplay(slider);
        });
        // Initialize sub-control visibility (they start hidden)
        toggleSubControls(`gradientControls${newIndex}`, false);
        toggleSubControls(`shadowControls${newIndex}`, false);

        // Ensure the animation plays - already handled by CSS class
        // newControl.classList.add('animate-scaleIn'); // Add animation class
    }
    updateCanvas(); // Update canvas after adding the new text layer
}

// Function to calculate the Axis-Aligned Bounding Box (AABB) of rotated text
function getTextAABB(ctx, text, font, fontWeight, size, rotation, translateX, translateY) {
    ctx.save();
    ctx.font = `${fontWeight} ${size}px "${font}"`; // Set font to measure accurately
    const metrics = ctx.measureText(text);
    // Restore context state immediately after measuring
    // No need to restore here if we don't change anything else in the context for measurement
    // ctx.restore();

    // Approximate height (can be improved with font metrics if available, but often sufficient)
    // Using fontBoundingBoxAscent/Descent is more accurate but complex
    const textHeight = size * 1.2; // Common approximation factor
    const textWidth = metrics.width;

    const halfW = textWidth / 2;
    const halfH = textHeight / 2; // Use approximate height

    // Define corners relative to the text center (0,0) before rotation/translation
    const corners = [
        { x: -halfW, y: -halfH }, // Top-left approx
        { x: halfW, y: -halfH },  // Top-right approx
        { x: halfW, y: halfH },   // Bottom-right approx
        { x: -halfW, y: halfH }    // Bottom-left approx
    ];

    const rad = rotation * Math.PI / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);

    // Rotate and translate corners
    const transformedCorners = corners.map(corner => {
        const rotatedX = corner.x * cos - corner.y * sin;
        const rotatedY = corner.x * sin + corner.y * cos;
        return {
            x: rotatedX + translateX,
            y: rotatedY + translateY
        };
    });

    // Find min/max X and Y coordinates
    const minX = Math.min(...transformedCorners.map(c => c.x));
    const maxX = Math.max(...transformedCorners.map(c => c.x));
    const minY = Math.min(...transformedCorners.map(c => c.y));
    const maxY = Math.max(...transformedCorners.map(c => c.y));

    ctx.restore(); // Restore context state *after* calculation using rotated values
    return { left: minX, right: maxX, top: minY, bottom: maxY };
}

function updateCanvas() {
    // Ensure context and images are ready
    if (!ctx || !canvasElement || !backgroundImage || !backgroundImage.complete) return;
    if (subjectImage && !subjectImage.complete) return; // Wait for subject too if it exists

    // Logical canvas size is already set, just clear
    ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // --- Draw Background Image ---
    // Use stored aspect ratio for efficiency
    if (!bgImageAspect) {
        bgImageAspect = backgroundImage.naturalWidth / backgroundImage.naturalHeight;
    }
    const canvasAspect = canvasElement.width / canvasElement.height;
    let drawWidth, drawHeight, drawX, drawY;

    if (bgImageAspect > canvasAspect) { // Image wider than canvas
        drawWidth = canvasElement.width;
        drawHeight = drawWidth / bgImageAspect;
        drawX = 0;
        drawY = (canvasElement.height - drawHeight) / 2;
    } else { // Image taller than or equal aspect to canvas
        drawHeight = canvasElement.height;
        drawWidth = drawHeight * bgImageAspect;
        drawY = 0;
        drawX = (canvasElement.width - drawWidth) / 2;
    }
    ctx.drawImage(backgroundImage, drawX, drawY, drawWidth, drawHeight);


    // --- Draw Text Layers (Behind Subject) ---
    textBoundingBoxes = []; // Reset bounding boxes for hit detection
    textControls.forEach(index => {
        const textControlDiv = document.querySelector(`.text-control[data-text-index="${index}"]`);
        if (!textControlDiv) return; // Skip if controls were removed unexpectedly

        // Retrieve all control values for this layer
        // Using optional chaining ?. for robustness in case an element is missing briefly
        const textInput = textControlDiv.querySelector(`#textInput${index}`);
        const fontSelect = textControlDiv.querySelector(`#fontSelect${index}`);
        const fontWeightSelect = textControlDiv.querySelector(`#fontWeight${index}`);
        const textSizeSlider = textControlDiv.querySelector(`#textSize${index}`);
        const textColorPicker = textControlDiv.querySelector(`#textColor${index}`);
        const textXOffsetSlider = textControlDiv.querySelector(`#textXOffset${index}`);
        const textYOffsetSlider = textControlDiv.querySelector(`#textYOffset${index}`);
        const textRotationSlider = textControlDiv.querySelector(`#textRotation${index}`);
        const textOpacitySlider = textControlDiv.querySelector(`#textOpacity${index}`);
        const blurCheckbox = textControlDiv.querySelector(`#blur${index}`);
        const enableGradientCheckbox = textControlDiv.querySelector(`#enableGradient${index}`);
        const gradientColorPicker = textControlDiv.querySelector(`#gradientColor${index}`);
        const enableShadowCheckbox = textControlDiv.querySelector(`#enableShadow${index}`);
        const shadowColorPicker = textControlDiv.querySelector(`#shadowColor${index}`);
        const shadowBlurSlider = textControlDiv.querySelector(`#shadowBlur${index}`);
        const shadowOffsetSlider = textControlDiv.querySelector(`#shadowOffset${index}`);

        // Get values - providing defaults or logging errors if elements don't exist
        const text = textInput?.value || '';
        const font = fontSelect?.value || 'Poppins';
        const fontWeight = fontWeightSelect?.value || '400';
        const size = parseFloat(textSizeSlider?.value || '100');
        const color = textColorPicker?.value || '#FFFFFF';
        const xOffset = parseFloat(textXOffsetSlider?.value || '0');
        const yOffset = parseFloat(textYOffsetSlider?.value || '0');
        const rotation = parseFloat(textRotationSlider?.value || '0');
        const opacity = parseFloat(textOpacitySlider?.value || '1');
        const blur = blurCheckbox?.checked || false;
        const enableGradient = enableGradientCheckbox?.checked && !gradientColorPicker?.disabled;
        const gradientColor = gradientColorPicker?.value || '#EC4899';
        const enableShadow = enableShadowCheckbox?.checked && !shadowColorPicker?.disabled;
        const shadowColor = shadowColorPicker?.value || '#000000';
        const shadowBlur = parseFloat(shadowBlurSlider?.value || '0');
        const shadowOffset = parseFloat(shadowOffsetSlider?.value || '0');


        ctx.save(); // Save context state before applying transformations/styles

        // --- Transformations ---
        const translateX = canvasElement.width / 2 + xOffset;
        const translateY = canvasElement.height / 2 + yOffset;
        ctx.translate(translateX, translateY);
        ctx.rotate(rotation * Math.PI / 180);

        // --- Styles ---
        ctx.globalAlpha = opacity;
        ctx.font = `${fontWeight} ${size}px "${font}"`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.filter = blur ? `blur(2px)` : 'none'; // Basic blur

        // Shadow (Apply only if enabled)
        ctx.shadowColor = enableShadow ? shadowColor : 'rgba(0,0,0,0)';
        ctx.shadowBlur = enableShadow ? shadowBlur : 0;
        ctx.shadowOffsetX = enableShadow ? shadowOffset : 0;
        ctx.shadowOffsetY = enableShadow ? shadowOffset : 0; // Simple offset, use both X/Y

        // Fill Style (Gradient or Solid Color)
        if (enableGradient) {
            const textMetrics = ctx.measureText(text);
            const gradWidth = Math.max(textMetrics.width, 1);
            const gradient = ctx.createLinearGradient(-gradWidth / 2, 0, gradWidth / 2, 0);
            gradient.addColorStop(0, color);
            gradient.addColorStop(1, gradientColor);
            ctx.fillStyle = gradient;
        } else {
            ctx.fillStyle = color;
        }

        // Calculate AABB *before* drawing, using the current transformations
        // Note: getTextAABB performs its own save/restore internally if needed for measurements
        const aabb = getTextAABB(ctx, text, font, fontWeight, size, rotation, translateX, translateY);
        textBoundingBoxes.push({ index, aabb });

        // --- Draw Text ---
        // Text is drawn at (0,0) relative to the transformed context
        ctx.fillText(text, 0, 0);

        ctx.restore(); // Restore context state for the next layer or subject
    });


    // --- Draw Subject Image (Foreground) ---
    if (subjectImage && subjectImage.complete) {
        // Use the same drawing parameters as the background to ensure alignment
        ctx.drawImage(subjectImage, drawX, drawY, drawWidth, drawHeight);
    }
}

function saveCanvas() {
    if (!backgroundImage || !ctx || !canvasElement) {
        alert("No image to save. Please process an image first.");
        return;
    }

    const link = document.createElement('a');
    let filenamePrefix = 'peektext_output';
    if (textControls.length > 0) {
        const firstTextIndex = textControls[0];
        const firstTextInput = document.getElementById(`textInput${firstTextIndex}`);
        if (firstTextInput?.value) {
            const safeText = firstTextInput.value.substring(0, 20).replace(/[^a-z0-9]/gi, '_').toLowerCase();
            if (safeText) filenamePrefix = `PeekText_${safeText}`;
        }
    }
    link.download = `${filenamePrefix}.png`;

    try {
         // Ensure canvas is up-to-date before exporting
         updateCanvas(); // Make one final draw call if needed
         link.href = canvasElement.toDataURL('image/png', 1.0); // PNG format, quality ignored but set to 1.0
         link.click();
    } catch (e) {
         console.error("Error generating data URL for saving:", e);
         alert("Could not save the image. Check the browser console for more details.");
    }
}

// Resets the editor state back to the initial upload view
function resetToUploadView(scrollToUpload = false) {
    // Hide Editor, Show Upload
    if (editorSection) { editorSection.classList.add('hidden'); editorSection.classList.remove('visible'); }
    if (uploadInputArea) uploadInputArea.classList.remove('hidden');
    if (uploadLoadingArea) { uploadLoadingArea.classList.add('hidden'); uploadLoadingArea.classList.remove('flex');} // Ensure loader is hidden

    // Clear Images and State
    backgroundImage = null;
    subjectImage = null;
    bgImageAspect = null; // Clear stored aspect ratio
    selectedFile = null;
    textControls = [];
    textBoundingBoxes = [];
    draggingTextIndex = null;
    isDragging = false; // Reset dragging flag
    if (animationFrameRequestId) { // Cancel any pending animation frame
        cancelAnimationFrame(animationFrameRequestId);
        animationFrameRequestId = null;
    }


    // Revoke Object URLs to free memory
    if (originalObjectUrl) { URL.revokeObjectURL(originalObjectUrl); originalObjectUrl = null; }
    if (processedObjectUrl) { URL.revokeObjectURL(processedObjectUrl); processedObjectUrl = null; }

    // Clear Canvas
    if (ctx && canvasElement) {
        // Reset canvas size and clear drawing
        canvasElement.width = referenceWidth;
        canvasElement.height = referenceHeight;
        canvasElement.style.width = 'auto'; // Reset display size
        canvasElement.style.height = 'auto';
        ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
     }

    // Clear Text Controls and Add Placeholder Back
    if (textControlsContainer) {
        textControlsContainer.innerHTML = ''; // Clear dynamic controls
        // Re-add placeholder
        const placeholderDiv = document.createElement('div');
        placeholderDiv.id = 'textControlsPlaceholder';
        placeholderDiv.className = 'text-center text-white/70 py-8 px-4 italic';
        placeholderDiv.textContent = 'Your text controls will appear here...';
        textControlsContainer.appendChild(placeholderDiv);
    }

    // Reset Upload Input UI
    resetFileInput(); // Use the dedicated function
    if (addTextButton) addTextButton.disabled = true; // Disable add text button

    // Optionally scroll back to upload section
    if (scrollToUpload) {
        document.getElementById('upload')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

// Reloads the entire page for a full reset
function resetPage() {
    // Consider adding confirmation if needed:
    // if (confirm("Are you sure you want to start over? All changes will be lost.")) {
        window.location.reload();
    // }
}

// --- Action Handlers (used by event delegation) ---

// OPTIMIZATION: Function to handle collapsing/expanding text controls
function toggleTextControlCollapse(index, button) {
    const controlSet = document.getElementById(`textControlSet${index}`);
    const chevron = button.querySelector('.chevron-icon');
    if (!controlSet || !chevron) return;

    const isCollapsed = controlSet.classList.contains('collapsed');

    if (isCollapsed) {
        // Expand: Remove 'collapsed' class. CSS transition handles the animation.
        controlSet.classList.remove('collapsed');
        chevron.classList.remove('rotate-180');
        // Set max-height explicitly to allow transition *from* 0
        // Needs to be large enough to accommodate content.
        controlSet.style.maxHeight = controlSet.scrollHeight + "px";
        // Optional: Reset max-height after transition to allow dynamic height later
        // controlSet.addEventListener('transitionend', () => {
        //     controlSet.style.maxHeight = null;
        // }, { once: true });

    } else {
        // Collapse: Calculate current height, set it, then set to 0 for transition.
        controlSet.style.maxHeight = controlSet.scrollHeight + "px"; // Set current height
        requestAnimationFrame(() => { // Allow browser to apply the height
            controlSet.style.maxHeight = "0px"; // Set target height for transition
            controlSet.classList.add('collapsed');
            chevron.classList.add('rotate-180');
        });
    }
}


// OPTIMIZATION: Function to handle deleting text controls
function deleteTextControl(index) {
    // Convert index to number just in case
    const numericIndex = parseInt(index, 10);
    const controlElement = document.querySelector(`.text-control[data-text-index="${numericIndex}"]`);

    if (controlElement) {
        // Animate out
        controlElement.style.transition = 'opacity 0.2s ease-out, transform 0.2s ease-out, margin 0.2s ease-out, padding 0.2s ease-out';
        controlElement.style.opacity = '0';
        controlElement.style.transform = 'scale(0.95)';
        controlElement.style.marginTop = '0';
        controlElement.style.marginBottom = '0';
        controlElement.style.paddingTop = '0';
        controlElement.style.paddingBottom = '0';

        // Remove after animation
        setTimeout(() => {
            controlElement.remove();
            // Update the state array
            textControls = textControls.filter(i => i !== numericIndex);
            // If no controls left, re-add placeholder
            if (textControls.length === 0 && textControlsContainer && !document.getElementById('textControlsPlaceholder')) {
                 const placeholderDiv = document.createElement('div');
                 placeholderDiv.id = 'textControlsPlaceholder';
                 placeholderDiv.className = 'text-center text-white/70 py-8 px-4 italic';
                 placeholderDiv.textContent = 'Your text controls will appear here...';
                 textControlsContainer.appendChild(placeholderDiv);
            }
            updateCanvas(); // Update canvas after removing the layer
        }, 200); // Match timeout to animation duration
    } else {
        console.warn(`Could not find text control element for index ${numericIndex} to delete.`);
        // Clean up state array just in case the element is gone but state remains
        textControls = textControls.filter(i => i !== numericIndex);
        updateCanvas();
    }
}


// --- Initial Page Load Setup ---
document.addEventListener('DOMContentLoaded', () => {
    if (addTextButton) addTextButton.disabled = true; // Ensure Add Text is disabled initially

    // OPTIMIZATION: Apply debounced resize handler
    window.addEventListener('resize', debounce(resizeCanvas, 150));

    // Smooth scrolling for anchor links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
        anchor.addEventListener('click', function(e) {
            const targetId = this.getAttribute('href');
            // Basic check if it's just '#'
            if (targetId === '#') {
                e.preventDefault(); // Prevent jump to top for empty hash
                window.scrollTo({ top: 0, behavior: 'smooth' });
                return;
            }

            try {
                const targetElement = document.querySelector(targetId);
                if (targetElement) {
                    e.preventDefault(); // Prevent default jump only if target exists

                    // Close mobile menu if open and link is clicked
                    if (this.classList.contains('mobile-nav-link') && mobileMenu && !mobileMenu.classList.contains('hidden')) {
                        mobileMenu.classList.add('hidden');
                        if (hamburgerIcon) hamburgerIcon.classList.remove('hidden');
                        if (closeIcon) closeIcon.classList.add('hidden');
                    }
                    // Perform smooth scroll
                    targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' }); // Adjust 'block' if needed
                } else {
                     console.warn(`Smooth scroll target not found for selector: ${targetId}`);
                     // Allow default behavior if target isn't found (might be a link off-page)
                }
            } catch (error) { // Catch potential errors with querySelector (e.g., invalid ID)
                console.error(`Error finding element for smooth scroll: ${targetId}`, error);
                // Allow default behavior on error
            }
        });
    });

     // Initial call to size the canvas *after* ensuring layout is stable
     // Run slightly later to allow font loading and initial rendering
     // No need to call updateCanvas here, resizeCanvas will do it.
     // But only call resizeCanvas IF backgroundImage exists (won't on initial load)
     // The resize will happen properly after image processing.
     // setTimeout(resizeCanvas, 100); // Delay removed, resize happens after image load now
});

// --- Global Error Handling (Optional but Recommended) ---
window.addEventListener('error', (event) => {
  console.error('Unhandled global error:', event.error, event.message);
  // Potentially log this error to a server or analytics service
});

window.addEventListener('unhandledrejection', (event) => {
  console.error('Unhandled promise rejection:', event.reason);
  // Potentially log this error
});