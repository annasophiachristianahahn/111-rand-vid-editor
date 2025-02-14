// Helper: Append progress messages into the status div
function updateProgress(message) {
  const statusDiv = document.getElementById('status');
  const p = document.createElement('p');
  p.textContent = message;
  statusDiv.appendChild(p);
  statusDiv.scrollTop = statusDiv.scrollHeight;
}

document.getElementById('start-button').addEventListener('click', async () => {
  const files = document.getElementById('video-files').files;
  const finalLength = parseInt(document.getElementById('final-length').value);
  const minClipLength = parseInt(document.getElementById('min-clip-length').value);
  const maxClipLength = parseInt(document.getElementById('max-clip-length').value);
  const zoomProbability = parseFloat(document.getElementById('zoom-probability').value);
  const minZoom = parseFloat(document.getElementById('min-zoom').value);
  const maxZoom = parseFloat(document.getElementById('max-zoom').value);
  const flipProbability = parseFloat(document.getElementById('flip-probability').value);

  // NEW: Get final canvas dimensions from the index.html file
  const finalWidth = parseInt(document.getElementById('final-width').value);
  const finalHeight = parseInt(document.getElementById('final-height').value);

  // Clear previous status messages and hide download button
  document.getElementById('status').innerHTML = '';
  document.getElementById('download-button').style.display = 'none';

  updateProgress('Checking input values...');
  if (!files.length) {
      updateProgress('Error: Please select at least one video file.');
      return;
  }

  if (
      isNaN(finalLength) ||
      isNaN(minClipLength) ||
      isNaN(maxClipLength) ||
      minClipLength > maxClipLength ||
      isNaN(zoomProbability) ||
      isNaN(minZoom) ||
      isNaN(maxZoom) ||
      minZoom > maxZoom ||
      isNaN(finalWidth) ||
      isNaN(finalHeight) ||
      isNaN(flipProbability)
  ) {
      updateProgress('Error: Please enter valid numeric values.');
      return;
  }

  updateProgress('Starting video editing process...');
  await processVideos(files, finalLength, minClipLength, maxClipLength, zoomProbability, minZoom, maxZoom, finalWidth, finalHeight, flipProbability);
});

async function processVideos(files, finalLength, minClipLength, maxClipLength, zoomProbability, minZoom, maxZoom, finalWidth, finalHeight, flipProbability) {
  updateProgress('Initializing processing...');
  
  // Prepare canvas
  const canvas = document.createElement('canvas');
  canvas.width = finalWidth;
  canvas.height = finalHeight;
  updateProgress(`Canvas prepared: ${finalWidth}px x ${finalHeight}px`);

  const ctx = canvas.getContext('2d');
  const chunks = [];

  // Set up recording stream
  const stream = canvas.captureStream(30);
  updateProgress('Canvas capture stream started at 30 FPS.');

  // Set up media recorder with encoding options.
  let options = {
      mimeType: 'video/mp4; codecs="avc1.42E01E"',
      videoBitsPerSecond: 8000000
  };
  let recorder;
  try {
      recorder = new MediaRecorder(stream, options);
      updateProgress('Media recorder initialized with H.264 codec.');
  } catch (e) {
      updateProgress('H.264 configuration not supported, using default settings.');
      recorder = new MediaRecorder(stream);
  }

  // Report encoding chunk progress
  recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
          updateProgress(`Encoding chunk received: ${e.data.size} bytes.`);
          chunks.push(e.data);
      }
  };

  recorder.onstop = () => {
      updateProgress('Encoding finished. Finalizing video...');
      const blob = new Blob(chunks, { type: recorder.mimeType });
      const videoURL = URL.createObjectURL(blob);
      document.getElementById('output-video').src = videoURL;
      updateProgress('Video processing completed.');

      // Show and configure the DOWNLOAD button
      const downloadBtn = document.getElementById('download-button');
      downloadBtn.style.display = 'block';
      downloadBtn.onclick = () => {
          const a = document.createElement('a');
          a.href = videoURL;
          a.download = 'final_video.mp4';
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
      };
  };

  // Build randomized clip configurations until total duration meets or exceeds finalLength.
  let totalDuration = 0;
  const clipConfs = [];
  const filesArray = Array.from(files);
  let lastIndex = -1;
  updateProgress('Building clip configurations...');
  while (totalDuration < finalLength) {
      let candidateIndex;
      if (filesArray.length > 1) {
          // Build an array of indices excluding the lastIndex.
          const eligibleIndices = [];
          for (let i = 0; i < filesArray.length; i++) {
              if (i !== lastIndex) {
                  eligibleIndices.push(i);
              }
          }
          candidateIndex = eligibleIndices[Math.floor(Math.random() * eligibleIndices.length)];
      } else {
          candidateIndex = 0;
      }
      lastIndex = candidateIndex;
      const candidate = filesArray[candidateIndex];
      const duration = await getVideoDuration(candidate);
      const clipLength = getRandomClipLength(minClipLength, maxClipLength, duration);
      const startTime = getRandomStartTime(duration, clipLength);
      clipConfs.push({ file: candidate, startTime, clipLength });
      totalDuration += clipLength;
      updateProgress(`Added clip from ${candidate.name}: start=${startTime.toFixed(2)}s, length=${clipLength.toFixed(2)}s. Total planned duration: ${totalDuration.toFixed(2)}s`);
  }
  updateProgress('Clip configuration complete.');

  // Create video players (prevent fullscreen for iPhone by using inline playback).
  const videoPlayers = [];
  for (let i = 0; i < 4; i++) {
      const video = document.createElement('video');
      video.setAttribute('playsinline', 'true');
      video.setAttribute('webkit-playsinline', 'true');
      video.muted = true;
      video.autoplay = true;
      videoPlayers.push(video);
  }
  updateProgress('Video players created for preloading.');

  // Preload first clip.
  if (clipConfs.length === 0) {
      updateProgress('No clips to process.');
      return;
  }
  const firstClip = clipConfs.shift();
  updateProgress(`Preloading first clip from ${firstClip.file.name} (start: ${firstClip.startTime.toFixed(2)}s, length: ${firstClip.clipLength.toFixed(2)}s) into slot 0`);
  await preloadClip(videoPlayers[0], firstClip.file, firstClip.startTime, firstClip.clipLength);
  videoPlayers[0].clipConf = firstClip;
  updateProgress(`First clip preloaded successfully.`);

  // Preload remaining clips.
  for (let i = 1; i < videoPlayers.length; i++) {
      if (clipConfs.length > 0) {
          const clip = clipConfs.shift();
          updateProgress(`Preloading clip from ${clip.file.name} (start: ${clip.startTime.toFixed(2)}s, length: ${clip.clipLength.toFixed(2)}s) into slot ${i}`);
          await preloadClip(videoPlayers[i], clip.file, clip.startTime, clip.clipLength);
          videoPlayers[i].clipConf = clip;
          updateProgress(`Slot ${i} clip preloaded.`);
      }
  }

  // Start the recording process.
  recorder.start();
  const recordStartTime = performance.now();
  updateProgress('Recording started.');

  let currentPlayerIndex = 0;
  let previousClip = null;
  // Build zoomConfig including the flipProbability.
  const zoomConfig = { zoomProbability, minZoom, maxZoom, flipProbability };

  // Process clips while within finalLength.
  while (performance.now() - recordStartTime < finalLength * 1000) {
      if (!videoPlayers[currentPlayerIndex].clipConf) break;
      const currentVideo = videoPlayers[currentPlayerIndex];
      const currentClip = currentVideo.clipConf;

      updateProgress(`Processing clip from ${currentClip.file.name}`);
      const playPromise = playActiveClip(
          currentVideo,
          currentClip,
          canvas,
          ctx,
          zoomConfig,
          previousClip,
          recordStartTime,
          finalLength
      );

      // Preload next clip if available.
      if (clipConfs.length > 0) {
          const upcoming = clipConfs.shift();
          const nextIndex = (currentPlayerIndex + 1) % videoPlayers.length;
          updateProgress(`Preloading upcoming clip from ${upcoming.file.name} into slot ${nextIndex}`);
          await preloadClip(
              videoPlayers[nextIndex],
              upcoming.file,
              upcoming.startTime,
              upcoming.clipLength
          );
          videoPlayers[nextIndex].clipConf = upcoming;
          updateProgress(`Upcoming clip preloaded into slot ${nextIndex}`);
      }
      await playPromise;
      updateProgress(`Finished processing clip from ${currentClip.file.name}`);

      previousClip = { video: currentVideo, conf: currentClip };
      currentPlayerIndex = (currentPlayerIndex + 1) % videoPlayers.length;
  }

  // Wait if early completion.
  const elapsed = performance.now() - recordStartTime;
  if (elapsed < finalLength * 1000) {
      updateProgress(`Waiting for remaining time: ${(finalLength * 1000 - elapsed) / 1000}s`);
      await new Promise(resolve => setTimeout(resolve, finalLength * 1000 - elapsed));
  }

  recorder.stop();
  updateProgress('Recording stopped.');
}

function getVideoDuration(file) {
  return new Promise((resolve) => {
      const tempVideo = document.createElement('video');
      tempVideo.src = URL.createObjectURL(file);
      tempVideo.onloadedmetadata = () => {
          updateProgress(`Loaded metadata for ${file.name}: duration ${tempVideo.duration.toFixed(2)}s`);
          resolve(tempVideo.duration);
      };
  });
}

function getRandomClipLength(minClipLength, maxClipLength, duration) {
  const minLength = (minClipLength / 100) * duration;
  const maxLength = (maxClipLength / 100) * duration;
  const clipLength = Math.random() * (maxLength - minLength) + minLength;
  updateProgress(`Determined clip length: ${clipLength.toFixed(2)}s (duration ${duration.toFixed(2)}s)`);
  return clipLength;
}

function getRandomStartTime(duration, clipLength) {
  const startTime = Math.random() * (duration - clipLength);
  updateProgress(`Random start time chosen: ${startTime.toFixed(2)}s for clip length ${clipLength.toFixed(2)}s`);
  return startTime;
}

function preloadClip(video, file, startTime, clipLength) {
  updateProgress(`Starting preload for ${file.name} at ${startTime.toFixed(2)}s for ${clipLength.toFixed(2)}s clip.`);
  return new Promise((resolve, reject) => {
      video.src = URL.createObjectURL(file);
      video.currentTime = startTime;
      video.onloadedmetadata = () => {
          video.onseeked = () => {
              updateProgress(`Preload complete for ${file.name} at ${startTime.toFixed(2)}s`);
              resolve();
          };
          video.onerror = (e) => reject(e);
      };
      video.onerror = (e) => reject(e);
  });
}

// Play a clip by drawing frames from the video onto the canvas.
// The drawFrame function stops drawing when the elapsed time reaches finalLength.
function playActiveClip(video, clipConf, canvas, ctx, zoomConfig, previousClip, recordStartTime, finalLength) {
  return new Promise((resolve, reject) => {
      const { startTime, clipLength, file } = clipConf;
      const overlapDuration = 1.0; // 1 second overlap

      // Determine whether to apply zoom.
      let applyZoom = Math.random() < (zoomConfig.zoomProbability / 100);
      let zoomFactor = 1;
      let fixedOffsetX, fixedOffsetY, zoomedSW, zoomedSH;

      // Compute base crop rectangle based on canvas aspect ratio.
      const videoAspect = video.videoWidth / video.videoHeight;
      const canvasAspect = canvas.width / canvas.height;
      let baseSX, baseSY, baseSW, baseSH;
      if (videoAspect > canvasAspect) {
          baseSH = video.videoHeight;
          baseSW = video.videoHeight * canvasAspect;
          baseSX = (video.videoWidth - baseSW) / 2;
          baseSY = 0;
      } else {
          baseSW = video.videoWidth;
          baseSH = video.videoWidth / canvasAspect;
          baseSY = (video.videoHeight - baseSH) / 2;
          baseSX = 0;
      }
      
      if (applyZoom) {
          zoomFactor = Math.random() * ((zoomConfig.maxZoom - zoomConfig.minZoom) / 100) + (zoomConfig.minZoom / 100);
          zoomedSW = baseSW / zoomFactor;
          zoomedSH = baseSH / zoomFactor;
          const maxOffsetX = baseSW - zoomedSW;
          const maxOffsetY = baseSH - zoomedSH;
          fixedOffsetX = baseSX + Math.random() * maxOffsetX;
          fixedOffsetY = baseSY + Math.random() * maxOffsetY;
          updateProgress(`Applied zoom on ${file.name}: ${(zoomFactor * 100).toFixed(0)}%, crop at x:${fixedOffsetX.toFixed(0)}, y:${fixedOffsetY.toFixed(0)}`);
      }
      
      // Determine if the clip should be flipped horizontally.
      const flipClip = Math.random() < (zoomConfig.flipProbability / 100);
      if (flipClip) {
          updateProgress(`Applied horizontal flip on ${file.name}`);
      }
      
      video.play().then(() => {
          // Using a local timer to track the clip duration.
          const clipStartTimestamp = performance.now();
          const drawFrame = () => {
              // If the overall recording time exceeds finalLength, stop immediately.
              if (performance.now() - recordStartTime >= finalLength * 1000) {
                  resolve();
                  return;
              }
              
              ctx.clearRect(0, 0, canvas.width, canvas.height);

              // Draw previous clip during the overlap period.
              if (previousClip && video.currentTime < startTime + overlapDuration) {
                  ctx.drawImage(previousClip.video, 0, 0, canvas.width, canvas.height);
              }
              
              // Apply flipping if needed.
              if (flipClip) {
                  ctx.save();
                  ctx.translate(canvas.width, 0);
                  ctx.scale(-1, 1);
              }

              if (applyZoom) {
                  ctx.drawImage(video, fixedOffsetX, fixedOffsetY, zoomedSW, zoomedSH, 0, 0, canvas.width, canvas.height);
              } else {
                  ctx.drawImage(video, baseSX, baseSY, baseSW, baseSH, 0, 0, canvas.width, canvas.height);
              }
              
              if (flipClip) {
                  ctx.restore();
              }
              
              // Check using the timer instead of relying solely on video.currentTime.
              if (performance.now() - clipStartTimestamp >= clipLength * 1000) {
                  updateProgress(`Clip from ${file.name} completed.`);
                  resolve();
              } else {
                  requestAnimationFrame(drawFrame);
              }
          };
          drawFrame();
      }).catch((e) => {
          updateProgress(`Error playing clip from file ${file.name}: ${e.message}`);
          console.error(`Error playing clip from file: ${file.name}`, e);
          reject(e);
      });
  });
}