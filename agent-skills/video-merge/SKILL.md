---
name: video-merge
description: Ordering, transitions and constraints for merge_videos.
---
# Merging videos with merge_videos

- `video_urls`: **2–100** URLs, merged **in the order given**. Confirm the order with the user when it
  isn't obvious from the request.
- `transition`: `none` (hard cut, default), `fade` or `dissolve`. Use `none` unless the user asks for a
  smoother transition.
- Clips with different resolutions or frame rates are normalised by the service; expect the output to
  match the first clip.
- Cost is per minute of output (about 0.05M credits per minute), so warn the user before merging long
  clips.

After merging, say how many clips were joined, in which order and with which transition. The merged
video is shown inline.
