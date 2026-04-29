/**
 * Category:name → prompt phrase lookup. Pure string data.
 */

export const PRESET_PROMPT_LIBRARY: Record<string, string> = {
  // ── camera (was camera + motion) ──
  'camera:zoom-in':
    'smooth camera zoom in toward the subject, gradually tightening framing while maintaining focus',
  'camera:zoom-out':
    'camera steadily zooms out revealing the wider scene and surrounding environment',
  'camera:pan-left':
    'camera pans horizontally to the left, sweeping across the scene in a smooth lateral rotation',
  'camera:pan-right':
    'camera pans horizontally to the right, revealing new elements across the frame',
  'camera:tilt-up':
    'camera tilts upward from ground level, gradually revealing height and vertical scale',
  'camera:tilt-down': 'camera tilts downward, descending from an elevated view toward ground level',
  'camera:dolly-in':
    'camera physically moves forward toward the subject on a dolly track, creating depth parallax',
  'camera:dolly-out':
    'camera pulls back on a dolly track, creating increasing distance and depth separation',
  'camera:truck-left':
    'camera trucks laterally to the left, moving parallel to the subject maintaining constant distance',
  'camera:truck-right':
    'camera trucks laterally to the right, tracking alongside the scene in a smooth lateral glide',
  'camera:orbit-cw':
    'camera orbits clockwise around the subject, revealing it from continuously shifting angles',
  'camera:orbit-ccw':
    'camera orbits counter-clockwise around the subject, circling with fluid motion',
  'camera:crane-up':
    'camera rises vertically on a crane, ascending above the scene for an elevated perspective',
  'camera:crane-down':
    'camera descends vertically on a crane, lowering from an aerial view toward ground level',
  'camera:handheld-shake':
    'handheld camera with subtle organic shake, giving a raw documentary feel',
  'camera:steadicam-follow':
    'smooth steadicam following the subject, gliding through the scene with fluid stabilization',
  'camera:static-hold': 'camera holds completely still, locked-off static shot with no movement',
  'camera:subtle-drift':
    'gentle barely perceptible camera drift, slow floating movement adding organic life to the frame',
  'camera:push-in':
    'camera slowly pushes forward into the scene, gradually closing distance to the subject',
  'camera:pull-out':
    'camera slowly pulls backward, widening the view and revealing surrounding context',
  'camera:lateral-slide-left':
    'smooth lateral camera slide to the left, horizontal tracking motion revealing depth parallax',
  'camera:lateral-slide-right':
    'smooth lateral camera slide to the right, horizontal tracking with layered depth separation',
  'camera:arc-left':
    'camera arcs to the left around the subject in a curved path, shifting perspective smoothly',
  'camera:arc-right':
    'camera arcs to the right around the subject in a curved path, revealing new angles',
  'camera:whip-pan':
    'rapid whip pan with motion blur, fast rotational camera sweep creating energetic transition',
  'camera:snap-zoom':
    'sudden fast snap zoom toward the subject, impactful punch-in creating dramatic emphasis',
  'camera:parallax-reveal':
    'parallax motion where foreground and background layers move at different speeds, revealing depth',
  'camera:rack-focus':
    'rack focus shifting between foreground and background subjects, redirecting attention through depth',
  'camera:handheld-run':
    'running handheld camera with pronounced bounce and shake, urgent kinetic chase energy',
  'camera:fpv-glide':
    'smooth FPV drone-style forward glide, flowing through the environment at speed with stable horizon',
  'camera:spiral-rise':
    'camera spirals upward in a rising helical path, combining rotation with vertical ascent',
  'camera:bullet-time':
    'bullet-time frozen moment with camera rotating around a suspended instant in time',

  // ── lens ──
  'lens:ultra-wide-14mm':
    'ultra-wide 14mm lens, expansive field of view with barrel distortion at edges, dramatic perspective exaggeration',
  'lens:wide-24mm':
    'wide-angle 24mm lens, broad perspective with subtle depth exaggeration and environmental context',
  'lens:normal-50mm':
    '50mm standard lens, natural human-eye perspective with minimal distortion, balanced depth of field',
  'lens:portrait-85mm':
    '85mm portrait lens, flattering compression with creamy shallow depth of field and soft background bokeh',
  'lens:telephoto-135mm':
    '135mm telephoto lens, compressed perspective flattening depth layers, isolating the subject',
  'lens:long-telephoto-200mm':
    '200mm telephoto lens, extreme perspective compression with heavily blurred background, narrow depth of field',
  'lens:macro':
    'macro lens extreme close-up, revealing fine surface detail and textures at microscopic scale, paper-thin depth of field',
  'lens:fisheye':
    'fisheye lens with extreme spherical barrel distortion, 180-degree field of view, curving all straight lines',
  'lens:tilt-shift':
    'tilt-shift lens creating selective focus plane, miniature diorama effect with sharp band of focus',
  'lens:anamorphic':
    'anamorphic lens with horizontal lens flares, oval bokeh, and subtle barrel squeeze creating widescreen cinematic feel',
  'lens:vintage-soft':
    'vintage soft-focus lens with gentle halation around highlights, dreamy glow, and reduced contrast',
  'lens:pinhole':
    'pinhole camera effect, infinite depth of field with soft overall rendering and natural vignette',

  // ── look (was style + color + texture) ──
  'look:cinematic-realism':
    'photorealistic cinematic quality, film grain, natural color grading, shallow depth of field, anamorphic lens flares',
  'look:anime-cel':
    'anime cel-shaded style, bold outlines, flat color fills, vibrant saturated palette, expressive stylized features',
  'look:watercolor-ink':
    'watercolor and ink wash style, flowing wet-on-wet pigment bleeds, visible paper texture, organic edges',
  'look:oil-paint':
    'oil painting style, visible thick impasto brushstrokes, rich layered pigments, canvas texture, classical technique',
  'look:claymation':
    'claymation stop-motion style, soft rounded forms, visible finger impressions, warm tactile clay surfaces',
  'look:pixel-art':
    'pixel art retro style, crisp pixel-perfect grid, limited color palette, 8-bit aesthetic with dithering',
  'look:comic-book':
    'comic book illustration style, bold ink outlines, halftone dot shading, dynamic action poses, speech bubble aesthetic',
  'look:noir-film':
    'film noir black-and-white style, high contrast shadows, venetian blind patterns, hard-boiled detective atmosphere',
  'look:sci-fi-neon':
    'sci-fi neon cyberpunk style, glowing neon accents, holographic interfaces, dark metallic surfaces, futuristic tech',
  'look:fantasy-epic':
    'epic fantasy illustration style, sweeping landscapes, dramatic magical lighting, ornate detailed armor and architecture',
  'look:documentary-gritty':
    'gritty documentary style, raw handheld feel, available light, desaturated realistic tones, unpolished authenticity',
  'look:pastel-dream':
    'pastel dreamlike style, soft muted pastel colors, ethereal glow, gentle gradients, serene floating quality',
  'look:gothic-baroque':
    'gothic baroque style, ornate dramatic architecture, deep shadows, rich gold and crimson, religious gravitas',
  'look:minimal-clean':
    'minimal clean design style, white space, geometric simplicity, crisp edges, reduced palette, modern restraint',
  'look:retro-80s':
    'retro 1980s style, VHS grain, scan lines, synthwave neon gradients, chrome reflections, nostalgia aesthetic',
  'look:surreal-dali-esque':
    'surrealist Dali-esque style, impossible geometry, melting forms, dreamscape logic, uncanny juxtaposition',
  'look:teal-orange':
    'teal and orange color grading, complementary cool shadows against warm highlights, cinematic blockbuster palette',
  'look:monochrome-cool':
    'cool monochrome palette, blue-grey single-hue range with cold steel and ice undertones',
  'look:monochrome-warm':
    'warm monochrome palette, amber-sepia single-hue range with golden and umber earth tones',
  'look:complementary-pop':
    'complementary color pop, opposing hue pair creating vibrant visual tension and eye-catching contrast',
  'look:analogous-serene':
    'analogous serene color harmony, neighboring hues blending smoothly for calm unified palette',
  'look:triadic-vibrant':
    'triadic vibrant color scheme, three evenly spaced hues creating dynamic balanced chromatic energy',
  'look:pastel-soft':
    'soft pastel color palette, gentle muted tints with low saturation, airy and delicate',
  'look:earth-tones':
    'natural earth tone palette, warm browns, olive greens, terracotta, and ochre, organic grounded feel',
  'look:neon-synthwave':
    'neon synthwave palette, electric pink, cyan, and purple against deep black, retro-futuristic glow',
  'look:bleach-bypass':
    'bleach bypass look, desaturated silvery highlights with increased contrast, muted color and metallic sheen',
  'look:sepia-vintage':
    'sepia vintage toning, warm brownish-yellow monochrome evoking aged photographs and nostalgia',
  'look:high-contrast-bw':
    'high contrast black and white, deep pure blacks and bright whites with minimal mid-tones',
  'look:smooth-polished':
    'smooth polished surface finish, sleek reflective quality with clean uniform appearance',
  'look:matte-flat':
    'matte flat surface, non-reflective diffuse finish absorbing light evenly without glare',
  'look:grainy-film':
    'analog film grain texture, organic photographic noise with varying grain size and density',
  'look:rough-grit':
    'rough gritty surface texture, coarse irregular particles with tactile abrasive character',
  'look:glossy-wet':
    'glossy wet surface, specular reflections with liquid sheen and mirror-like highlights',
  'look:velvet-soft':
    'soft velvet texture, plush micro-fiber surface absorbing light with rich deep shadows in folds',
  'look:metallic-brushed':
    'brushed metallic texture, directional fine scratches on metal surface with anisotropic reflections',
  'look:paper-fiber':
    'paper fiber texture, visible cellulose grain and subtle surface irregularities of fine art paper',
  'look:ceramic-glaze':
    'ceramic glaze finish, smooth vitreous coating with subtle crazing pattern and pooled depth variation',
  'look:glass-crisp':
    'crisp glass surface, transparent refractive material with sharp reflections and caustic light patterns',
  'look:concrete-porous':
    'porous concrete texture, rough aggregate surface with air pockets and mineral variation',
  'look:fabric-weave':
    'woven fabric texture, visible thread interlocking pattern with textile drape and fiber detail',
  'look:wes-anderson-pastel':
    'symmetrical centered one-point composition, pastel warm yellows and pinks, flat even diffused lighting with no harsh shadows, precise deadpan framing, storybook whimsy, Kodak Vision3 250D color science',
  'look:wong-karwai-neon':
    'smeared neon reflections on wet surfaces, step-printed motion blur on subject, saturated deep reds and smoky greens, expired film grain, 135mm telephoto compression isolating protagonist in crowd, CineStill 800T halation',
  'look:kubrick-symmetry':
    'strict one-point perspective symmetry, cold clinical overhead lighting with no fill, wide-angle 18mm lens distortion, deep shadow corridors converging to vanishing point, unsettling geometric precision',
  'look:shinkai-luminous':
    'hyper-detailed luminous sky gradients with vivid blues and oranges, dust motes floating and glowing in golden backlight, cinematic anime still quality, volumetric god rays through clouds, Tyndall effect atmosphere',
  'look:kodak-portra-400':
    'Kodak Portra 400 film color science, warm natural skin tones with gentle highlight rolloff, soft organic grain, lifted shadows with creamy mid-tones, slightly warm color temperature bias',
  'look:cinestill-800t':
    'CineStill 800T tungsten-balanced color science, red halation halos bleeding around practical light sources, warm orange skin tones against cool blue shadows, cinematic night atmosphere with visible grain',
  'look:fujifilm-eterna':
    'Fujifilm Eterna color grading, cool muted desaturated tones, restrained cinematic palette with subtle green-blue cast in shadows, low contrast rolloff, documentary restraint',
  'look:ilford-hp5':
    'Ilford HP5 black and white film, rich organic grain structure, deep pure blacks with bright whites, high dynamic range, classic analog texture with natural tonal separation',
  'look:french-new-wave':
    'handheld natural available light, casual spontaneous framing with slight imperfection, desaturated documentary realism, jump-cut aesthetic energy, 35mm wide lens, Fujifilm Eterna muted tones',
  'look:y2k-chrome':
    'brushed chrome and iridescent metallic surfaces, cold blue-teal color grading, soft-focus halation around highlights, chromatic aberration at edges, retro-futurist millennium aesthetic, long exposure light trails',
  'look:vaporwave':
    'pastel pink and purple gradient atmosphere, glitch artifact overlays, lo-fi digital dreamscape, greek statue motifs, 80s nostalgia grid lines, low saturation with neon accent pops',
  'look:brutalist-concrete':
    'raw exposed concrete surfaces with aggregate texture, monumental geometric forms casting harsh directional shadows, oppressive architectural scale, minimal ornamentation, desaturated cool palette',
  'look:stop-motion-clay':
    'plasticine clay figures with visible fingerprint impressions on surface, low frame rate jitter at 8fps, warm practical tungsten lighting, handmade tactile imperfection, stop-motion animation aesthetic',
  'look:cross-stitch':
    'dense colored cotton thread on Aida cloth grid, X-shaped stitch pattern visible at pixel level, slight fabric weave texture beneath, craft textile aesthetic with warm thread sheen variation between rows',
  'look:rotoscope':
    'hand-traced animation over live footage, painterly organic line art with fluid movement, semi-transparent layered color fills, visible brush stroke quality, rotoscope animation style',
  'look:needle-felt':
    'coarse mixed-color wool fibers with fuzzy soft surface detail, needle-felted texture with visible fiber direction, handmade doll aesthetic, warm diffused lighting on tactile craft surface',

  // ── scene (was lighting + environment) ──
  'scene:golden-hour':
    'warm golden hour sunlight, low sun angle casting long shadows with rich amber and orange tones',
  'scene:blue-hour':
    'cool blue hour twilight, soft diffused ambient light with deep blue and indigo atmospheric tones',
  'scene:high-key':
    'bright high-key lighting, minimal shadows with even illumination and clean white tones',
  'scene:low-key':
    'dramatic low-key lighting, deep shadows with selective illumination creating strong chiaroscuro contrast',
  'scene:rim-light':
    'strong rim light outlining the subject edges with a bright halo, separating from background',
  'scene:silhouette':
    'backlit silhouette, subject rendered as a dark shape against a bright luminous background',
  'scene:split-lighting':
    'split lighting dividing the face or subject into equal halves of light and shadow',
  'scene:butterfly-lighting':
    'butterfly lighting from directly above creating a shadow beneath the nose, glamorous Paramount style',
  'scene:rembrandt-lighting':
    'Rembrandt lighting with a triangular highlight on the shadowed cheek, classic painterly illumination',
  'scene:volumetric-godrays':
    'volumetric god rays piercing through atmosphere, visible shafts of light with dust particles',
  'scene:neon-noir':
    'neon-lit noir atmosphere, colored neon reflections on wet surfaces with deep urban shadows',
  'scene:candlelit':
    'warm candlelight illumination, flickering soft amber glow with intimate close-range falloff',
  'scene:moonlit':
    'cool moonlight casting pale silver-blue illumination with soft long shadows in night setting',
  'scene:overcast-soft':
    'soft overcast diffused lighting, even illumination with minimal shadows and neutral color temperature',
  'scene:fog-light':
    'light atmospheric fog, soft mist reducing visibility with gentle diffused depth haze',
  'scene:fog-heavy':
    'dense heavy fog, thick obscuring mist severely limiting visibility with ethereal atmosphere',
  'scene:rain-light':
    'light rain falling, fine gentle raindrops with wet reflective surfaces and overcast sky',
  'scene:rain-heavy':
    'heavy downpour rain, intense rainfall with splashing puddles, streaming water, and reduced visibility',
  'scene:snow-gentle':
    'gentle snowfall, soft floating snowflakes drifting slowly with quiet winter atmosphere',
  'scene:snow-blizzard':
    'blizzard whiteout conditions, driving horizontal snow with fierce wind and near-zero visibility',
  'scene:dust-particles':
    'floating dust particles catching light, visible motes suspended in sunbeams with warm atmosphere',
  'scene:smoke':
    'wisps of smoke drifting through the scene, curling translucent haze with atmospheric depth',
  'scene:fire-embers':
    'glowing fire embers floating upward, hot orange sparks drifting against dark surroundings',
  'scene:underwater':
    'underwater environment, caustic light patterns on surfaces, floating particles, blue-green color cast',
  'scene:wind-leaves':
    'wind-blown leaves and debris, organic particles carried by breeze with dynamic natural motion',
  'scene:fireflies':
    'bioluminescent fireflies floating, small glowing points of warm light in dark natural setting',
  'scene:sandstorm':
    'sandstorm atmosphere, dense swirling sand particles with reduced visibility and warm amber haze',
  'scene:aurora':
    'aurora borealis in the sky, shimmering curtains of green and purple light across the polar night',

  // ── composition ──
  'composition:rule-of-thirds':
    'subject placed at rule-of-thirds intersection point, balanced asymmetric composition',
  'composition:center-frame':
    'subject centered in frame with symmetrical balance, direct frontal composition',
  'composition:golden-ratio':
    'composition following golden ratio spiral, subject at the natural focal convergence point',
  'composition:leading-lines':
    'strong leading lines drawing the eye toward the subject, converging perspective guides',
  'composition:dutch-angle':
    'tilted Dutch angle composition creating visual tension and unease, canted frame',
  'composition:negative-space':
    'large areas of empty negative space surrounding the subject, minimalist isolated framing',
  'composition:symmetrical':
    'perfectly symmetrical bilateral composition, mirrored balance across the center axis',
  'composition:frame-within-frame':
    'subject framed within an architectural or natural secondary frame, layered depth',
  'composition:over-the-shoulder':
    'over-the-shoulder framing with foreground figure partially visible, establishing spatial relationship',
  'composition:extreme-close-up':
    'extreme close-up filling the frame with fine detail, intimate and intense framing',

  // ── emotion ──
  'emotion:neutral':
    'neutral balanced atmosphere, calm and objective with no strong emotional weight',
  'emotion:hopeful':
    'hopeful uplifting atmosphere, warm light with open airy composition suggesting optimism and possibility',
  'emotion:tense':
    'tense suspenseful atmosphere, tight framing with shadows and restrained movement building anxiety',
  'emotion:awe':
    'awe-inspiring grandeur, vast scale with dramatic light revealing something magnificent and overwhelming',
  'emotion:melancholic':
    'melancholic somber mood, muted desaturated tones with slow contemplative movement and weight',
  'emotion:euphoric':
    'euphoric joyful energy, bright vivid colors with dynamic movement and radiant light',
  'emotion:ominous':
    'ominous foreboding atmosphere, dark shadows with low angles and unsettling tension building dread',
  'emotion:intimate':
    'intimate close personal atmosphere, soft shallow focus with warm tones and gentle proximity',
  'emotion:triumphant':
    'triumphant victorious energy, powerful upward angles with bold heroic light and grand scale',
  'emotion:playful':
    'playful lighthearted mood, bright saturated colors with bouncy dynamic movement and whimsy',
  'emotion:reflective':
    'reflective introspective atmosphere, still quiet moments with soft natural light and thoughtful framing',
  'emotion:urgent':
    'urgent pressing atmosphere, rapid movement with tight framing and heightened intensity driving forward',

  // ── flow (was pacing + transition) ──
  'flow:linger':
    'slow lingering pace, extended held moments allowing the scene to breathe with contemplative rhythm',
  'flow:measured':
    'measured deliberate pacing, controlled steady rhythm with purposeful timing between beats',
  'flow:conversational':
    'natural conversational pace, relaxed flowing rhythm matching dialogue and interaction tempo',
  'flow:energetic': 'energetic quick pace, brisk cuts and movements with dynamic forward momentum',
  'flow:frantic':
    'frantic rapid-fire pacing, chaotic urgency with fast cuts and intense compressed timing',
  'flow:rhythmic-pulse':
    'rhythmic pulsing pace, beats hitting at regular musical intervals creating hypnotic cadence',
  'flow:stop-and-breathe':
    'alternating between motion and stillness, punctuated pauses creating dramatic breathing room',
  'flow:acceleration-ramp':
    'gradually accelerating pace, starting slow and building speed toward a climactic peak',
  'flow:deceleration-ramp':
    'gradually decelerating pace, slowing from fast action into a calm contemplative stillness',
  'flow:montage-beat':
    'montage-style rhythmic cutting, quick sequential shots building narrative through juxtaposition',
  'flow:hard-cut':
    'sharp instantaneous cut with no transition effect, direct immediate scene change',
  'flow:match-cut':
    'match cut linking visually similar shapes or movements between shots for seamless continuity',
  'flow:jump-cut':
    'jump cut creating abrupt temporal skip, jarring forward leap within the same scene',
  'flow:crossfade':
    'smooth crossfade dissolve blending two shots together, gradual opacity transition',
  'flow:dip-to-black':
    'fade to black transition, scene darkening to full black before the next shot emerges',
  'flow:dip-to-white':
    'fade to white transition, scene brightening to pure white before revealing the next shot',
  'flow:wipe-left':
    'horizontal wipe transition sweeping left, new scene sliding in from the right edge',
  'flow:wipe-right':
    'horizontal wipe transition sweeping right, new scene sliding in from the left edge',
  'flow:whip-pan-transition':
    'fast whip pan blur connecting two shots, motion-blur wipe creating energetic continuity',
  'flow:morph':
    'morphing transition smoothly warping one scene shape into the next, fluid deformation blend',
  'flow:glitch-cut':
    'digital glitch transition with pixel distortion, chromatic aberration, and data corruption artifacts',
  'flow:film-burn':
    'film burn transition with organic light leak, warm overexposed chemical film degradation',
  'flow:luma-fade':
    'luminance-based fade transition, bright areas dissolving first creating ethereal depth-aware blend',
  'flow:iris-close':
    'circular iris closing transition, frame constricting to a point before opening on the next scene',

  // ── technical (was aspect-ratio + quality) ──
  'technical:cinematic-scope-239':
    '2.39:1 anamorphic cinemascope widescreen framing, ultra-wide horizontal composition',
  'technical:standard-wide-169':
    '16:9 standard widescreen framing, modern broadcast and web display composition',
  'technical:academy-43':
    '4:3 academy ratio framing, classic television and vintage film composition',
  'technical:vertical-mobile-916':
    '9:16 vertical portrait framing, mobile-first social media composition',
  'technical:square-11':
    '1:1 square framing, balanced equal-dimension composition for social media and gallery display',
  'technical:imax-143':
    '1.43:1 IMAX ratio framing, near-square tall format maximizing vertical field of view',
  'technical:ultra-wide-219':
    '21:9 ultra-widescreen framing, panoramic horizontal composition for immersive display',
  'technical:draft':
    'low-fidelity draft quality, fast preview rendering with reduced detail for rapid iteration',
  'technical:standard':
    'standard production quality, balanced detail and render time for general-purpose output',
  'technical:high-fidelity':
    'high-fidelity quality, enhanced detail density with refined textures and precise rendering',
  'technical:max-detail':
    'maximum detail ultra-quality, highest resolution rendering with full texture detail and precision',
  'technical:turbo-preview':
    'turbo fast preview, minimal-step rapid generation for quick concept exploration',
};
