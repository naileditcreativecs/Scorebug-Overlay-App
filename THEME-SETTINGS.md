CFB27 SCOREBUG — custom settings for your bug
=============================================

STATUS: this feature is coming in an upcoming app version. You can add
the settings block to your bug today - the app simply ignores it until
the feature ships, and your bug keeps working exactly as it does now.

What this is
------------
If your scorebug HTML has adjustable things - a resolution scale, a
show/hide records switch, a style variant, an accent color - you can
declare them, and the app builds a real settings menu for them inside
the in-game editor (Ctrl+Alt+O). Users get sliders and switches with
live preview; you get the values delivered straight into your bug. No
more editing the HTML to retune a number.

Quick start
-----------
1. Paste ONE block like this anywhere in your HTML (top of <body> is
   fine). It is plain JSON inside a script tag - it never executes:

   <script type="application/json" data-cfb27-settings>
   { "settings": [
     { "key": "scale",       "label": "Resolution",   "type": "slider",
       "min": 50, "max": 150, "step": 5, "default": 100, "unit": "%" },
     { "key": "showRecords", "label": "Show records", "type": "toggle",
       "default": true },
     { "key": "style",       "label": "Style",        "type": "choice",
       "options": ["Classic", "Modern"], "default": "Classic" },
     { "key": "accent",      "label": "Accent color", "type": "color",
       "default": "#ffde00" }
   ] }
   </script>

2. Read the values in your bug. They arrive in the same state object
   your bug already reads scores from, under "themeSettings":

     themeSettings.scale        -> 120        (number)
     themeSettings.showRecords  -> true/false (boolean)
     themeSettings.style        -> "Modern"   (one of your options)
     themeSettings.accent       -> "#ffde00"  (hex string)

   Values arrive BEFORE your first paint and again live on every
   change while the user drags a slider. If themeSettings is missing
   or a key is absent, use your default - that is exactly what happens
   on the very first run and in app versions older than this feature.

The four control types
----------------------
slider   A numeric slider.
         Required: key, label, type, min, max, default.
         Optional: step (default 1), unit (shown after the number).

toggle   An on/off switch.
         Required: key, label, type, default (true or false).

choice   A pick-one list. Rendered as buttons or a dropdown.
         Required: key, label, type, options (2-12 strings), default
         (must be one of the options).

color    A color swatch + picker.
         Required: key, label, type, default ("#rrggbb").

Rules the app enforces
----------------------
- Up to 20 settings per bug. Labels up to 40 characters.
- key: letters/numbers/underscore, starts with a letter, up to 32
  characters. Keys are what the app saves values under - once your
  bug is published, KEEP KEYS STABLE across versions.
- Every delivered value is clamped/validated against your declaration:
  a slider never arrives outside min..max, a choice never arrives with
  a value you did not list, a color is always a valid #rrggbb. You can
  trust the values without re-checking them.
- A malformed entry is dropped; the rest of the block still works. A
  malformed block means "no custom settings" - it never breaks the bug.
- Labels are displayed as plain text. HTML in labels shows as text.

How values are saved
--------------------
Automatic and per-bug: each scorebug in the library keeps its own
values, restored every time that bug loads. When you publish an
updated version of your bug, saved values carry forward wherever the
KEY matches - another reason to keep keys stable. New keys start at
their defaults.

Wiring it in your code (ESPN-style bugs)
----------------------------------------
If your bug uses an update()/paint() pattern with a state object, the
values land like any other field. Example:

    function applySettings(s) {
      if (!s) return;
      if (s.scale !== undefined)
        bug.style.transform = 'scale(' + (s.scale / 100) + ')';
      if (s.showRecords !== undefined)
        document.body.classList.toggle('no-records', !s.showRecords);
      if (s.accent) bug.style.setProperty('--accent', s.accent);
    }
    // in your update(obj) handler:
    if (obj.themeSettings) applySettings(obj.themeSettings);

Testing before the feature ships
--------------------------------
You do not need the app to develop against this. Open your HTML in a
browser and drive it by hand from the console:

    update({ themeSettings: { scale: 120, showRecords: false } });

Tip: if you keep a dev panel with test controls in your file, put it
OUTSIDE the element marked data-cfb27-root. The app isolates that root,
so your dev panel never appears on stream (the ESPN 2020 flag demo
button works this way).

What your bug already receives today
------------------------------------
For reference, the state your bug gets from the app right now (all as
strings unless noted): awayName, awayRank, awayRecord, awayScore,
awayColor, awayLogo, awayPossession (bool), awayTimeouts (number), the
same home* fields, quarter, clock, playClock, down, distance,
downDistance, plus penalties: game.flag (bool, true while the game's
own FLAG banner is up) and game.penaltyFlag ('away'/'home' when the
game says whose flag it is, 'flag' when it does not). Common alternate
key spellings (away_name, team1Score, ...) are accepted by the app's
default bugs - your bug decides its own spelling; the app sends both
nested ({away:{name}}) and flat forms through its bridge.

Questions / a control type you need that is not here? Say so before
the feature ships - adding a type later is easy, changing one is not.
