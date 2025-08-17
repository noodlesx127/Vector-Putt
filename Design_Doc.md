Game Design Document: Vector Putt (Working Title)
1. Game Overview

Vector Putt is a 2D, top-down, physics-based minigolf game. The player's objective is to get a golf ball into a hole in the fewest possible shots across a series of increasingly complex courses.

The game is designed to be intuitive and easy to learn, but challenging to master. Its core appeal lies in its simple controls, satisfying physics, and clever level design that feels like a puzzle. It is intended for a casual audience of all ages who enjoy skill-based challenges.
2. Core Gameplay Mechanics

The gameplay loop is simple: aim your shot, hit the ball, and watch it interact with the level until it stops. Repeat until the ball is in the hole.
2.1 The Shot Mechanic

The entire game is controlled with a simple, one-button mouse action:

    Aiming: The player clicks and holds the mouse button on the golf ball. An arrow instantly appears, originating from the center of the ball.

    Direction: The player aims by moving the mouse around the ball. The arrow pivots to show the intended direction of the shot.

    Power: The power of the shot is determined by the distance the player pulls the cursor away from the ball. A longer arrow indicates a more powerful shot; a shorter arrow indicates a gentler tap. A visual power meter or the changing color/length of the arrow provides clear feedback.

    Shooting: The player releases the mouse button to launch the ball.

This single, fluid action makes the core mechanic feel tactile and gives the player complete control over every shot.
2.2 Ball Physics

The ball is the central object of the game. Its movement should feel consistent and predictable.

    Rolling & Friction: Once struck, the ball travels in the chosen direction, gradually slowing down due to friction with the ground.

    Bouncing: The ball will ricochet off walls and other hard obstacles. The angle of reflection should equal the angle of incidence to feel fair and allow for predictable bank shots.

    Velocity: The ball's speed is determined by the power of the shot. Its speed affects how it interacts with certain terrain (e.g., skipping over sand if hit hard enough).

2.3 Scoring

    Strokes: The primary goal is to minimize the stroke count. Each shot a player takes adds +1 to their score for the current hole.

    Par: Each hole has a "Par" value, which is the expected number of strokes a skilled player might take to complete it.

    Score Feedback: At the end of a hole, the player's performance is displayed with traditional golf terms (e.g., "Birdie" for 1-under-par, "Par" for matching par, "Bogey" for 1-over-par).

    Total Score: The game keeps a running total of the player's strokes across the entire course.

3. Level Design & Environment

Each level, or "hole," is a self-contained puzzle. The environment is the primary source of challenge and fun.
3.1 Terrain Types

Levels are constructed from a few basic terrain types, each with unique physical properties:

    Fairway (Green): The standard playing surface. It has a medium level of friction.

    Walls: Impassable borders that define the shape of the hole. The ball bounces off them cleanly.

    Sand Traps (Yellow/Tan): A hazard that dramatically increases friction. A ball landing in sand will slow down very quickly, making it difficult to get out.

    Water (Blue): A major hazard. If the ball enters the water, it is considered "out of bounds."

        Penalty: The player incurs a 1-stroke penalty.

        Reset: The ball is returned to the position it was in before the last shot.

3.2 Obstacles & Features

While the core levels are built from the terrains above, more advanced courses can introduce new elements to keep the gameplay fresh:

    Ramps & Hills: Sloped surfaces that can alter the ball's speed and direction.

    Moving Obstacles: Blocks or walls that move on a set path, requiring timed shots.

    Boosters/Accelerators: Areas that give the ball a speed boost.

    Tunnels & Teleporters: Holes that transport the ball from one point on the map to another.

## 3.3 Screenshot Observations (from provided references)

These notes capture concrete UI/level elements visible in the screenshots to guide scope and visuals.

- Walls and Borders
  - Thick, light gray/white walls outline fairways; sometimes angled (non-axis-aligned) segments and chamfered corners.
  - Full outer frame around the entire course with mustard/dark-olive table background.
- Terrain & Hazards
  - Bright blue water channels acting as OOB barriers along edges and within corridors.
  - Sand pits rendered as tan shapes (triangular bowl-like in some levels).
  - Standard green fairway with subtle shading bands in some areas.
- Obstacles
  - Diagonal bumpers/deflectors inside rooms.
  - Pillars/posts with circular caps arranged in rows.
  - Flowerbeds used both as decoration and as a border motif.
- Decorations / Theming
  - Repeating flower border around fairway edges on certain holes (white and red variants).
  - Distinct per-level theming via water presence, flower patterns, and shading blocks.
- UI Cues
  - HUD strip above playfield includes course name, stroke pips, replay button.
  - Replay button on the right; hole title on the top bar.

Implications for implementation
- Add support for diagonal walls and chamfered corners (geometry + collision).
- Add terrain zones: Water (OOB with +1 stroke/reset), Sand (high friction), Fairway (baseline friction).
- Add decoration layers: flower border tiles, simple pattern fills; these are visual-only and non-colliding.
- Add outer frame rendering (light wall) distinct from inner play walls; consider separate level fields.
- Expand HUD to optionally show hole name and a Replay button.

4. Art Style & Sound Design

The presentation should be clean, simple, and functional, ensuring the gameplay is always the focus.
4.1 Visuals

The game uses a minimalist, 2D vector art style.

    Shapes: Levels are built from simple geometric shapes (rectangles, circles, polygons).

    Colors: A bright, high-contrast color palette is used. Each terrain type has a distinct, solid color, making the course instantly readable.

    Palette (as implemented in `src/main.ts` `COLORS`):

        Table (background): #7a7b1e
        Fairway:           #126a23
        Fairway band:      #115e20
        Fairway outline:   #0b3b14
        Wall fill:         #e2e2e2
        Wall stroke:       #bdbdbd
        Hole fill:         #0a1a0b
        Hole rim:          #0f3f19
        HUD text:          #111111
        HUD bg (dark):     #0d1f10

    Notes:
    - The fairway area is inset within the table background to mirror the reference look.
    - HUD text is rendered directly over the table background in dark text for contrast.

    UI: The user interface elements are clean, with legible fonts and simple icons. There is no visual clutter.

4.2 Sound Design

Sound effects provide crucial feedback to the player.

    Ball Hit: A satisfying "thwack" or "putt" sound.

    Wall Bounce: A distinct "knock" sound.

    Water Splash: A "plop" sound for water hazards.

    Sand Roll: A gritty, scraping sound when the ball is in a sand trap.

    Hole Sink: A celebratory sound, like a ball dropping in a cup, followed by a short positive jingle.

    Music: The background music should be light, cheerful, and relaxing. It should be ambient and not distract from the concentration needed to play.

5. User Interface (UI) & User Experience (UX)

The UI must be unobtrusive during gameplay but provide all necessary information at a glance.

    In-Game HUD: Displayed at the top of the screen, showing:

        Hole: The current hole number (e.g., "Hole: 3/9").

        Par: The par for the current hole (e.g., "Par: 4").

        Strokes: The player's current stroke count for that hole (e.g., "Strokes: 2").

    Post-Hole Scorecard: After a hole is completed, a simple screen appears, showing the result (e.g., "BIRDIE!") and the updated total score for the course.

    Main Menu: A simple menu with options to "Start Game," "Select Course," and view "Options" (like sound volume).