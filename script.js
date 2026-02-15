// Drag-and-drop setup
const dropArea = document.getElementById('dropArea');
const fileInput = document.getElementById('audioFile');
const fileNameEl = document.getElementById('fileName');
const status = document.getElementById('status');
const downloadLink = document.getElementById('download');
const previewSection = document.getElementById('previewSection');
const audioPreview = document.getElementById('audioPreview');
const repeatButton = document.getElementById('repeatButton');

dropArea.addEventListener('click', () => fileInput.click());

fileInput.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) fileNameEl.textContent = file.name;
});

['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, preventDefaults, false);
});

function preventDefaults(e) {
    e.preventDefault();
    e.stopPropagation();
}

['dragenter', 'dragover'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.add('dragover'), false);
});

['dragleave', 'drop'].forEach(eventName => {
    dropArea.addEventListener(eventName, () => dropArea.classList.remove('dragover'), false);
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

async function repeatAudio() {
    const file = fileInput.files[0];
    const repeats = parseInt(document.getElementById('repeats').value);

    if (!file) return alert('Please select an audio file.');
    if (isNaN(repeats) || repeats < 1) return alert('Enter a valid number ≥ 1.');

    repeatButton.disabled = true;
    downloadLink.style.display = 'none';
    previewSection.style.display = 'none';
    status.textContent = 'Starting...';
    status.className = 'processing';

    try {
        status.textContent = 'Decoding audio... (1/3)';
        
        const arrayBuffer = await file.arrayBuffer();
        const tempCtx = new (window.AudioContext || window.webkitAudioContext)();
        const originalBuffer = await tempCtx.decodeAudioData(arrayBuffer);

        status.textContent = 'Preparing repeat... (2/3)';

        const totalSamples = originalBuffer.length * repeats;
        if (totalSamples > 100_000_000) {
            const approxMin = Math.round(totalSamples / originalBuffer.sampleRate / 60);
            if (!confirm(`Large file (~${approxMin} min). May take time or crash tab. Continue?`)) {
                status.textContent = 'Cancelled';
                repeatButton.disabled = false;
                return;
            }
        }

        const offlineCtx = new OfflineAudioContext(
            originalBuffer.numberOfChannels,
            totalSamples,
            originalBuffer.sampleRate
        );

        const source = offlineCtx.createBufferSource();
        source.buffer = originalBuffer;
        source.loop = true;
        source.connect(offlineCtx.destination);

        source.start(0);
        source.stop(originalBuffer.duration * repeats);

        status.textContent = 'Rendering... (3/3) — please wait';
        
        const renderedBuffer = await offlineCtx.startRendering();

        status.textContent = 'Finalizing file...';
        
        const wavBlob = audioBufferToWav(renderedBuffer);

        const url = URL.createObjectURL(wavBlob);
        downloadLink.href = url;
        downloadLink.download = 'repeated_audio.wav';
        downloadLink.style.display = 'block';

        // Enable preview
        audioPreview.src = url;
        previewSection.style.display = 'block';

        status.textContent = 'Ready! Preview or download below ↓';
        status.className = 'success';

    } catch (error) {
        console.error(error);
        status.textContent = 'Error: ' + (error.message || 'Processing failed');
        status.className = 'error';
        alert('Error: ' + (error.message || 'Try another file or fewer repeats.'));
    } finally {
        repeatButton.disabled = false;
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
