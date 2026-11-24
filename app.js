const stage = document.querySelector('#camera-stage');
const video = document.querySelector('#camera');
const canvas = document.querySelector('#capture-canvas');
const startButton = document.querySelector('#start-camera');
const flipButton = document.querySelector('#flip-camera');
const shutterButton = document.querySelector('#shutter');
const assistButton = document.querySelector('#assist-button');
const emptyTitle = document.querySelector('#empty-title');
const emptyCopy = document.querySelector('#empty-copy');
const guideLayer = document.querySelector('#guide-layer');
const subjectOverlay = document.querySelector('#subject-overlay');
const subjectBox = document.querySelector('#subject-box');
const subjectTag = document.querySelector('#subject-tag');
const coachCard = document.querySelector('#coach-card');
const coachIcon = document.querySelector('#coach-icon');
const coachTitle = document.querySelector('#coach-title');
const coachCopy = document.querySelector('#coach-copy');
const zoomPill = document.querySelector('#zoom-pill');
const cameraCaptionRight = document.querySelector('#camera-caption-right');
const ratioSelect = document.querySelector('#ratio-select');
const ratioBadge = document.querySelector('#ratio-badge');
const photoModal = document.querySelector('#photo-modal');
const helpModal = document.querySelector('#help-modal');
const capturedPhoto = document.querySelector('#captured-photo');
const saveButton = document.querySelector('#save-button');
const retakeButton = document.querySelector('#retake-button');

const looks = {
  natural: 'none',
  warm: 'sepia(0.19) saturate(1.13) contrast(1.04) brightness(1.025)',
  mono: 'grayscale(1) contrast(1.07)',
};
const detectorAssets = {
  module: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/vision_bundle.mjs',
  wasm: 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm',
  model: 'https://storage.googleapis.com/mediapipe-models/object_detector/efficientdet_lite0/float32/1/efficientdet_lite0.tflite',
};
const frenchLabels = {
  person: 'personne', laptop: 'ordinateur portable', tv: 'écran', cell_phone: 'téléphone',
  book: 'livre', chair: 'chaise', cup: 'tasse', bottle: 'bouteille', keyboard: 'clavier',
  mouse: 'souris', clock: 'horloge', handbag: 'sac', backpack: 'sac à dos', dog: 'chien',
  cat: 'chat', potted_plant: 'plante', dining_table: 'table', couch: 'canapé', suitcase: 'valise',
};

let cameraStream = null;
let facingMode = 'environment';
let selectedLook = 'natural';
let lastPhotoBlob = null;
let lastPhotoName = 'cadre-photo.jpg';
let detector = null;
let detectorPromise = null;
let autoGuideEnabled = false;
let analysisTimer = 0;
let smoothedBox = null;
let missedDetections = 0;
let zoomAnchor = { x: 0.5, y: 0.5 };
let digitalZoom = 1;
let zoomCapabilities = null;
let baseOpticalZoom = 1;
let lastOpticalZoomCommand = 1;
let lastZoomMode = 'numérique';

function setCameraMessage(title, copy) {
  emptyTitle.textContent = title;
  emptyCopy.textContent = copy;
}

function setCoach(title, copy, icon = '✳', working = false) {
  coachTitle.textContent = title;
  coachCopy.textContent = copy;
  coachIcon.textContent = icon;
  coachCard.classList.toggle('is-working', working);
}

async function startCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setCameraMessage('Caméra indisponible', 'Ouvre cette page dans Safari après sa mise en ligne sécurisée.');
    return;
  }

  startButton.disabled = true;
  startButton.textContent = 'Ouverture de la caméra…';
  try {
    stopCamera();
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { facingMode: { ideal: facingMode }, width: { ideal: 1920 }, height: { ideal: 1440 } },
    });
    video.srcObject = cameraStream;
    await video.play();
    stage.classList.add('is-live');
    flipButton.disabled = false;
    shutterButton.disabled = false;
    assistButton.disabled = false;
    setCameraMessage('Prête quand tu l’es', 'Active la caméra pour voir ton cadrage.');
    if (autoGuideEnabled) beginAutoGuide();
  } catch (error) {
    const denied = error?.name === 'NotAllowedError' || error?.name === 'PermissionDeniedError';
    setCameraMessage(denied ? 'Autorise la caméra' : 'Impossible d’ouvrir la caméra', denied
      ? 'Vérifie l’autorisation de la caméra dans les réglages de Safari.'
      : 'Essaie à nouveau ou vérifie que la caméra est disponible.');
  } finally {
    startButton.disabled = false;
    startButton.innerHTML = 'Réessayer <span aria-hidden="true">↗</span>';
  }
}

function stopCamera() {
  window.clearTimeout(analysisTimer);
  analysisTimer = 0;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
    cameraStream = null;
  }
  video.srcObject = null;
  video.style.transform = '';
  subjectOverlay.hidden = true;
  zoomPill.hidden = true;
  cameraCaptionRight.textContent = 'Aucune photo n’est envoyée';
  digitalZoom = 1;
  zoomCapabilities = null;
  smoothedBox = null;
}

function setGuide(mode) {
  const paths = {
    thirds: 'M33.33 0V100 M66.67 0V100 M0 33.33H100 M0 66.67H100',
    center: 'M50 0V100 M0 50H100',
    golden: 'M38.2 0V100 M61.8 0V100 M0 38.2H100 M0 61.8H100',
  };
  guideLayer.querySelector('path').setAttribute('d', paths[mode]);
  guideLayer.classList.toggle('guide-center', mode === 'center');
  guideLayer.classList.toggle('guide-golden', mode === 'golden');
  document.querySelectorAll('[data-guide]').forEach((button) => {
    const selected = button.dataset.guide === mode;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function setLook(look) {
  selectedLook = look;
  stage.classList.remove('look-warm', 'look-mono');
  if (look === 'warm') stage.classList.add('look-warm');
  if (look === 'mono') stage.classList.add('look-mono');
  document.querySelectorAll('[data-look]').forEach((button) => {
    const selected = button.dataset.look === look;
    button.classList.toggle('is-selected', selected);
    button.setAttribute('aria-pressed', String(selected));
  });
}

function currentAspectRatio() {
  return { portrait: 4 / 5, square: 1, landscape: 3 / 2 }[ratioSelect.value];
}

function updateRatio() {
  stage.classList.remove('ratio-portrait', 'ratio-square', 'ratio-landscape');
  stage.classList.add(`ratio-${ratioSelect.value}`);
  ratioBadge.textContent = { portrait: '4:5', square: '1:1', landscape: '3:2' }[ratioSelect.value];
}

function cropDimensions(sourceWidth, sourceHeight, targetRatio) {
  const sourceRatio = sourceWidth / sourceHeight;
  if (sourceRatio > targetRatio) {
    const width = sourceHeight * targetRatio;
    return { sx: (sourceWidth - width) / 2, sy: 0, sw: width, sh: sourceHeight };
  }
  const height = sourceWidth / targetRatio;
  return { sx: 0, sy: (sourceHeight - height) / 2, sw: sourceWidth, sh: height };
}

function setAssistButton(active, loading = false) {
  assistButton.setAttribute('aria-pressed', String(active));
  assistButton.setAttribute('aria-label', active ? 'Désactiver le cadrage automatique' : 'Activer le cadrage automatique');
  assistButton.classList.toggle('is-loading', loading);
  assistButton.disabled = loading || !cameraStream;
}

async function loadDetector() {
  if (detector) return detector;
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const { FilesetResolver, ObjectDetector } = await import(detectorAssets.module);
      const vision = await FilesetResolver.forVisionTasks(detectorAssets.wasm);
      const commonOptions = {
        baseOptions: { modelAssetPath: detectorAssets.model },
        runningMode: 'VIDEO',
        scoreThreshold: 0.36,
        maxResults: 6,
      };
      try {
        detector = await ObjectDetector.createFromOptions(vision, {
          ...commonOptions,
          baseOptions: { ...commonOptions.baseOptions, delegate: 'GPU' },
        });
      } catch {
        detector = await ObjectDetector.createFromOptions(vision, commonOptions);
      }
      return detector;
    })().catch((error) => {
      detectorPromise = null;
      throw error;
    });
  }
  return detectorPromise;
}

function visibleSourceCrop() {
  const aspect = stage.clientWidth / stage.clientHeight;
  return cropDimensions(video.videoWidth, video.videoHeight, aspect);
}

function chooseDetection(detections) {
  const crop = visibleSourceCrop();
  const candidates = detections.map((detection) => {
    const box = detection.boundingBox;
    const category = detection.categories?.[0];
    if (!box || !category || category.score < 0.36) return null;
    const left = Math.max(box.originX, crop.sx);
    const top = Math.max(box.originY, crop.sy);
    const right = Math.min(box.originX + box.width, crop.sx + crop.sw);
    const bottom = Math.min(box.originY + box.height, crop.sy + crop.sh);
    if (right <= left || bottom <= top) return null;
    const normalized = {
      left: (left - crop.sx) / crop.sw,
      top: (top - crop.sy) / crop.sh,
      right: (right - crop.sx) / crop.sw,
      bottom: (bottom - crop.sy) / crop.sh,
      label: frenchLabels[category.categoryName] || category.categoryName.replaceAll('_', ' '),
      rawLabel: category.categoryName,
      score: category.score,
    };
    normalized.width = normalized.right - normalized.left;
    normalized.height = normalized.bottom - normalized.top;
    const priority = ['tv', 'laptop', 'person'].includes(normalized.rawLabel) ? 1.25 : 1;
    normalized.rank = category.score * (0.35 + Math.sqrt(normalized.width * normalized.height)) * priority;
    return normalized;
  }).filter(Boolean);
  return candidates.sort((a, b) => b.rank - a.rank)[0] || null;
}

function getCompositionTarget(label) {
  const mode = document.querySelector('[data-guide].is-selected')?.dataset.guide || 'thirds';
  if (mode === 'center') return { x: 0.5, y: 0.5 };
  if (mode === 'golden') return { x: 0.618, y: 0.382 };
  if (mode === 'thirds' && label === 'personne') return { x: 0.667, y: 0.333 };
  return { x: 0.5, y: 0.5 };
}

function applyZoomTransform(box, zoom) {
  zoomAnchor = {
    x: Math.min(1, Math.max(0, (box.left + box.right) / 2)),
    y: Math.min(1, Math.max(0, (box.top + box.bottom) / 2)),
  };
  video.style.transformOrigin = `${zoomAnchor.x * 100}% ${zoomAnchor.y * 100}%`;
  video.style.transform = zoom > 1.01 ? `scale(${zoom})` : '';
  const project = (point, anchor) => anchor + (point - anchor) * zoom;
  const left = project(box.left, zoomAnchor.x);
  const right = project(box.right, zoomAnchor.x);
  const top = project(box.top, zoomAnchor.y);
  const bottom = project(box.bottom, zoomAnchor.y);
  subjectBox.style.setProperty('--box-left', left * 100);
  subjectBox.style.setProperty('--box-top', top * 100);
  subjectBox.style.setProperty('--box-width', (right - left) * 100);
  subjectBox.style.setProperty('--box-height', (bottom - top) * 100);
  subjectTag.textContent = box.label;
  subjectOverlay.hidden = false;
}

function directionCopy(box) {
  const target = getCompositionTarget(box.label);
  const dx = (box.left + box.right) / 2 - target.x;
  const dy = (box.top + box.bottom) / 2 - target.y;
  const horizontal = Math.abs(dx) > 0.075 ? (dx < 0 ? 'à gauche' : 'à droite') : '';
  const vertical = Math.abs(dy) > 0.075 ? (dy < 0 ? 'vers le haut' : 'vers le bas') : '';
  if (!horizontal && !vertical) return 'C’est bien cadré — tu peux prendre la photo.';
  const directions = [horizontal, vertical].filter(Boolean);
  const arrow = `${dy < -0.075 ? '↑' : dy > 0.075 ? '↓' : ''}${dx < -0.075 ? '←' : dx > 0.075 ? '→' : ''}`;
  const instruction = directions.length === 2
    ? `Oriente vers ${horizontal}, ${vertical}`
    : `Oriente ${directions[0]}`;
  return `${arrow} ${instruction} pour mieux placer le sujet.`;
}

function setDigitalZoom(targetZoom) {
  digitalZoom = targetZoom;
  lastZoomMode = 'recadrage numérique';
  video.style.transformOrigin = `${zoomAnchor.x * 100}% ${zoomAnchor.y * 100}%`;
  video.style.transform = digitalZoom > 1.01 ? `scale(${digitalZoom})` : '';
  zoomPill.textContent = `${digitalZoom.toFixed(1).replace('.', ',')}× · numérique`;
  zoomPill.hidden = false;
}

function setAutomaticZoom(box) {
  const safeWidth = Math.max(box.width, 0.12);
  const safeHeight = Math.max(box.height, 0.12);
  const target = Math.min(2.35, Math.max(1, Math.min(0.5 / safeWidth, 0.55 / safeHeight)));
  const track = cameraStream?.getVideoTracks()[0];
  if (!zoomCapabilities && track?.getCapabilities) {
    try {
      const capabilities = track.getCapabilities();
      if (capabilities.zoom && capabilities.zoom.max > capabilities.zoom.min) {
        zoomCapabilities = capabilities.zoom;
        baseOpticalZoom = track.getSettings?.().zoom || capabilities.zoom.min || 1;
        lastOpticalZoomCommand = baseOpticalZoom;
      }
    } catch { /* Safari may not expose camera capabilities. */ }
  }

  if (zoomCapabilities && track?.applyConstraints) {
    const desired = Math.min(zoomCapabilities.max, Math.max(zoomCapabilities.min, target));
    digitalZoom = 1;
    video.style.transform = '';
    lastZoomMode = 'objectif';
    zoomPill.textContent = `${desired.toFixed(1).replace('.', ',')}× · objectif`;
    zoomPill.hidden = false;
    if (Math.abs(desired - lastOpticalZoomCommand) > 0.18) {
      lastOpticalZoomCommand = desired;
      track.applyConstraints({ advanced: [{ zoom: desired }] }).catch(() => {
        zoomCapabilities = null;
        setDigitalZoom(target);
        if (smoothedBox) applyZoomTransform(smoothedBox, digitalZoom);
      });
    }
  } else {
    setDigitalZoom(target);
  }
}

function updateGuidance(box) {
  applyZoomTransform(box, digitalZoom);
  const cameraInstruction = directionCopy(box);
  const zoomText = lastZoomMode === 'objectif' ? 'Zoom automatique par l’objectif.' : 'Zoom automatique par recadrage numérique.';
  const aligned = cameraInstruction.startsWith('C’est bien cadré');
  setCoach(aligned ? 'Sujet trouvé' : 'Sujet repéré', `${cameraInstruction} ${zoomText}`, aligned ? '✓' : '✳');
  cameraCaptionRight.textContent = `${box.label} · ${Math.round(box.score * 100)} %`;
}

function runDetection() {
  if (!autoGuideEnabled || !cameraStream || !detector || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;
  try {
    const result = detector.detectForVideo(video, performance.now());
    const detection = chooseDetection(result.detections || []);
    if (!detection) {
      missedDetections += 1;
      if (missedDetections >= 3) {
        smoothedBox = null;
        subjectOverlay.hidden = true;
        setAutomaticZoom({ width: 0.5, height: 0.5 });
        setCoach('Je cherche un sujet…', 'Garde la caméra stable et rapproche le sujet de la lumière.', '⌕', true);
        cameraCaptionRight.textContent = 'Recherche en cours';
      }
    } else {
      missedDetections = 0;
      if (!smoothedBox || smoothedBox.rawLabel !== detection.rawLabel) {
        smoothedBox = detection;
      } else {
        const alpha = 0.38;
        for (const key of ['left', 'top', 'right', 'bottom']) {
          smoothedBox[key] = smoothedBox[key] * (1 - alpha) + detection[key] * alpha;
        }
        smoothedBox.width = smoothedBox.right - smoothedBox.left;
        smoothedBox.height = smoothedBox.bottom - smoothedBox.top;
        smoothedBox.score = detection.score;
        smoothedBox.label = detection.label;
      }
      setAutomaticZoom(smoothedBox);
      updateGuidance(smoothedBox);
    }
  } catch {
    setCoach('Analyse en pause', 'Maintiens Safari ouvert et réactive le cadrage automatique.', '!');
  }
  if (autoGuideEnabled && cameraStream) analysisTimer = window.setTimeout(runDetection, 420);
}

async function beginAutoGuide() {
  if (!cameraStream) return;
  autoGuideEnabled = true;
  setAssistButton(true, true);
  setCoach('Préparation du cadrage…', 'Le modèle de détection se charge sur ton iPhone.', '✳', true);
  try {
    await loadDetector();
    if (!autoGuideEnabled || !cameraStream) return;
    missedDetections = 0;
    setAssistButton(true);
    setCoach('Je cherche un sujet…', 'Garde la caméra stable ; le premier chargement peut prendre un moment.', '⌕', true);
    runDetection();
  } catch {
    autoGuideEnabled = false;
    setAssistButton(false);
    setCoach('Détection indisponible', 'Vérifie ta connexion puis touche ✳ pour réessayer.', '!');
    cameraCaptionRight.textContent = 'Analyse non disponible';
  }
}

async function resetAutoZoom() {
  const track = cameraStream?.getVideoTracks()[0];
  if (zoomCapabilities && track?.applyConstraints && baseOpticalZoom !== lastOpticalZoomCommand) {
    lastOpticalZoomCommand = baseOpticalZoom;
    try { await track.applyConstraints({ advanced: [{ zoom: baseOpticalZoom }] }); } catch { /* Lens reset is best effort. */ }
  }
  digitalZoom = 1;
  video.style.transform = '';
  zoomPill.hidden = true;
}

async function toggleAutoGuide() {
  if (autoGuideEnabled) {
    autoGuideEnabled = false;
    window.clearTimeout(analysisTimer);
    analysisTimer = 0;
    missedDetections = 0;
    smoothedBox = null;
    subjectOverlay.hidden = true;
    await resetAutoZoom();
    setAssistButton(false);
    setCoach('Cadrage automatique en pause', 'Touche ✳ quand tu veux retrouver un sujet.');
    cameraCaptionRight.textContent = 'Aucune photo n’est envoyée';
    return;
  }
  beginAutoGuide();
}

function capturePhoto() {
  if (!video.videoWidth || !video.videoHeight) return;
  const aspect = currentAspectRatio();
  const source = cropDimensions(video.videoWidth, video.videoHeight, aspect);
  let crop = source;
  if (digitalZoom > 1.01) {
    const width = source.sw / digitalZoom;
    const height = source.sh / digitalZoom;
    let sx = source.sx + zoomAnchor.x * (source.sw - width);
    let sy = source.sy + zoomAnchor.y * (source.sh - height);
    sx = Math.min(video.videoWidth - width, Math.max(0, sx));
    sy = Math.min(video.videoHeight - height, Math.max(0, sy));
    crop = { sx, sy, sw: width, sh: height };
  }
  const outputHeight = 1500;
  const outputWidth = Math.round(outputHeight * aspect);
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d');
  context.filter = looks[selectedLook];
  context.drawImage(video, crop.sx, crop.sy, crop.sw, crop.sh, 0, 0, outputWidth, outputHeight);
  context.filter = 'none';
  canvas.toBlob((blob) => {
    if (!blob) return;
    lastPhotoBlob = blob;
    lastPhotoName = `cadre-${new Date().toISOString().slice(0, 10)}.jpg`;
    capturedPhoto.src = URL.createObjectURL(blob);
    photoModal.showModal();
  }, 'image/jpeg', 0.94);
}

async function savePhoto() {
  if (!lastPhotoBlob) return;
  const photoFile = new File([lastPhotoBlob], lastPhotoName, { type: 'image/jpeg' });
  if (navigator.canShare?.({ files: [photoFile] }) && navigator.share) {
    try {
      await navigator.share({ files: [photoFile], title: 'Ma photo Cadre' });
      return;
    } catch (error) {
      if (error?.name === 'AbortError') return;
    }
  }
  const link = document.createElement('a');
  link.href = URL.createObjectURL(lastPhotoBlob);
  link.download = lastPhotoName;
  link.click();
  URL.revokeObjectURL(link.href);
}

startButton.addEventListener('click', startCamera);
flipButton.addEventListener('click', async () => {
  facingMode = facingMode === 'environment' ? 'user' : 'environment';
  await startCamera();
});
assistButton.addEventListener('click', toggleAutoGuide);
shutterButton.addEventListener('click', capturePhoto);
ratioSelect.addEventListener('change', updateRatio);
document.querySelectorAll('[data-guide]').forEach((button) => button.addEventListener('click', () => setGuide(button.dataset.guide)));
document.querySelectorAll('[data-look]').forEach((button) => button.addEventListener('click', () => setLook(button.dataset.look)));
document.querySelector('#help-button').addEventListener('click', () => helpModal.showModal());
saveButton.addEventListener('click', savePhoto);
retakeButton.addEventListener('click', () => photoModal.close());
document.querySelectorAll('[data-close]').forEach((button) => button.addEventListener('click', () => document.querySelector(`#${button.dataset.close}`).close()));
document.querySelectorAll('.modal').forEach((dialog) => dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
}));
photoModal.addEventListener('close', () => {
  if (capturedPhoto.src.startsWith('blob:')) URL.revokeObjectURL(capturedPhoto.src);
  capturedPhoto.removeAttribute('src');
});

updateRatio();

if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
  window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}
