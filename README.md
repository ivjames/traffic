# Freeway Traffic Simulator

A browser-based freeway simulation focused on **driver behavior controls** and emergent traffic patterns at scale.

## Run

No build step is required.

- Option 1: open `index.html` directly in a browser.
- Option 2: serve the folder locally, e.g. `python3 -m http.server 8000`, then visit `http://localhost:8000`.

## Features

- Multi-lane freeway with hundreds of vehicles.
- Adjustable driver and traffic parameters:
  - inflow rate
  - desired speed
  - aggressiveness
  - reaction time
  - lane discipline
  - merge politeness
  - truck share
  - bottleneck strength
- Real-time stats:
  - active car count
  - average speed
  - density
  - slow-vehicle count (stop-and-go indicator)
- Pause/resume and reset controls.

## Modeling notes

The simulator uses a lightweight microscopic model inspired by common traffic-flow approaches:

- Car-following acceleration balances free-road acceleration and braking based on headway and closing speed.
- Lane changes compare expected acceleration between lanes and include courtesy/safety penalties.
- A configurable bottleneck zone can induce shockwaves and congestion.

This is intended for fast experimentation and qualitative pattern exploration rather than engineering-grade calibration.
