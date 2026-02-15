console.log("script.js loaded");

const dropArea    = document.getElementById('dropArea');
const fileInput   = document.getElementById('audioFile');
const fileNameEl  = document.getElementById('fileName');
const status      = document.getElementById('status');
const download    = document.getElementById('download');
const previewSec  = document.getElementById('previewSection');
const audioPrev   = document.getElementById('audioPreview');
const durationInfo = document.getElementById('durationInfo');
const processBtn  = document.getElementById('processButton');
const progressContainer = document.getElementById('progressContainer');
const progressFill = document.getElementById('progressFill');
const progressText = document.getElementById('progressText');

let selectedSpeed = 1;

// Safety check
if (!processBtn) console.error("processButton not found in HTML");
if (!progressContainer) console.error("progressContainer not found");

// Drag & drop
if (dropArea) {
    dropArea.addEventListener('click', () => fileInput.click());

    fileInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        fileNameEl.textContent = file ? file.name : '';
    });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(evt => {
        dropArea.addEventListener(evt, e => {
            e.preventDefault();
            e.stopPropagation();
        }, false);
    });

    ['dragenter', 'dragover'].forEach(evt => {
        dropArea.addEventListener(evt, () => dropArea.classList.add('dragover'), false);
    });

    ['dragleave', 'drop'].forEach(evt => {
        dropArea.addEventListener(evt, () => dropArea.classList.remove('dragover'), false);
    });

    dropArea.addEventListener('drop', (e) => {
        const file = e.dataTransfer.files[0];
        if (file && file.type.startsWith('audio/')) {
            fileInput.files = e.dataTransfer.files;
            fileNameEl.textContent = file.name;
        } else {
            alert('Please drop an audio file.');
        }
    });
}

// Speed selection
document.querySelectorAll('input[name="speed"]').forEach(radio => {
    radio.addEventListener('change', e => {
        selectedSpeed = parseFloat(e.target.value);
        console.log("Speed set to:", selectedSpeed);
    });
});

// Process button
if (processBtn) {
    processBtn.addEventListener('click', processAudio);
}

async function processAudio() {
    const file = fileInput.files[0];
    const repeats = parseInt(document.getElementById('repeats').value);

    if (!file) return alert('Please select an audio file first.');
    if (isNaN(repeats) || repeats < 1) return alert('Enter repeats ≥ 1.');

    processBtn.disabled = true;
    processBtn.textContent = 'Processing...';
    download.style.display = 'none';
    previewSec.style.display = 'none';
    status.textContent = 'Loading...';
    status.className = 'processing';

    progressContainer.style.display = 'block';
    progressFill.style.width = '0%';
    progressText.textContent = 'Decoding...';

    try {
        const arrayBuffer = await file.arrayBuffer();
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        const originalBuffer = await audioCtx.decodeAudioData(arrayBuffer);

        let workingBuffer = originalBuffer;

        // Speed change
        if (selectedSpeed !== 1) {
            status.textContent = `Speed → ${selectedSpeed}× ...`;
            progressText.textContent = 'Time stretching...';

            const newLength = Math.floor(originalBuffer.length / selectedSpeed);
            const speedCtx = new OfflineAudioContext(
                originalBuffer.numberOfChannels,
                newLength,
                originalBuffer.sampleRate
            );

            const src = speedCtx.createBufferSource();
            src.buffer = originalBuffer;
            src.playbackRate.value = selectedSpeed;
            src.connect(speedCtx.destination);
            src.start(0);

            workingBuffer = await speedCtx.startRendering();
        }

        // Repeat
        status.textContent = `Repeating ${repeats}× ...`;
        progressText.textContent = 'Combining...';

        const finalLength = workingBuffer.length * repeats;
        const finalBuffer = audioCtx.createBuffer(
            workingBuffer.numberOfChannels,
            finalLength,
            workingBuffer.sampleRate
        );

        let progress = 0;
        for (let r = 0; r < repeats; r++) {
            for (let ch = 0; ch < workingBuffer.numberOfChannels; ch++) {
                finalBuffer.copyToChannel(
                    workingBuffer.getChannelData(ch),
                    ch,
                    r * workingBuffer.length
                );
            }
            progress = ((r + 1) / repeats) * 100;
            progressFill.style.width = progress + '%';
            await new Promise(r => setTimeout(r, 0));
        }

        progressFill.style.width = '100%';
        progressText.textContent = 'Finalizing...';

        const wavBlob = audioBufferToWav(finalBuffer);
        const url = URL.createObjectURL(wavBlob);

        audioPrev.src = url;
        previewSec.style.display = 'block';

        const durationSec = finalBuffer.duration;
        durationInfo.textContent = `Duration: ${Math.floor(durationSec / 60)} min ${Math.round(durationSec % 60)} sec`;

        download.href = url;
        download.download = 'processed_audio.wav';
        download.style.display = 'block';

        status.textContent = `Done! (${selectedSpeed}× speed, ${repeats}× repeat)`;
        status.className = 'success';

    } catch (err) {
        console.error('Processing failed:', err);
        status.textContent = 'Error: ' + (err.message || 'Failed');
        status.className = 'error';
        progressText.textContent = 'Failed';
        alert('Error: ' + (err.message || 'Try smaller file or different browser.'));
    } finally {
        processBtn.disabled = false;
        processBtn.textContent = 'Process Audio';
        setTimeout(() => progressContainer.style.display = 'none', 2500);
    }
}

function audioBufferToWav(buffer) {
    const numChannels = buffer.numberOfChannels;
    const sampleRate = buffer.sampleRate;
    const length = buffer.length * numChannels * 2 + 44;
    const arrayBuffer = new ArrayBuffer(length);
    const view = new DataView(arrayBuffer);

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + buffer.length * numChannels * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numChannels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * numChannels * 2, true);
    view.setUint16(32, numChannels * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, buffer.length * numChannels * 2, true);

    let offset = 44;
    for (let i = 0; i < buffer.length; i++) {
        for (let channel = 0; channel < numChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
            offset += 2;
        }
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}
