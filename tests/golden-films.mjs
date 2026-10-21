// Gyllene filmer: handgjorda förebilder för hur en förklaringsfilm ska se ut (samma idé som
// "golden scenes" i fltman/infofilm). Används i granskningen (film-review.mjs), i e2e-testet,
// och "Avrunda till tiotal" är exemplet i filmprompten på servern.
export const golden = [
  {
    id: 'g1', name: 'Avrunda till tiotal', icon: 'calc',
    say: 'Avrunda till tiotal', show: { type: 'term', word: 'Avrunda' },
    film: {
      say: 'När du avrundar till närmaste tiotal tittar du på entalssiffran. Tjugotre ligger närmare tjugo, så det blir tjugo. Tjugosju ligger närmare trettio, så det blir trettio. Är entalet fem eller mer avrundar du uppåt.',
      steps: [
        { cue: 'närmaste tiotal', els: [
          { k: 'line', x1: 90, y1: 300, x2: 710, y2: 300 },
          { k: 'path', d: 'M90 286v28M152 292v16M214 292v16M276 292v16M338 292v16M400 288v24M462 292v16M524 292v16M586 292v16M648 292v16M710 286v28' },
          { k: 'text', t: '20', x: 90, y: 360, size: 2 },
          { k: 'text', t: '30', x: 710, y: 360, size: 2 } ] },
        { cue: 'entalssiffran', els: [
          { k: 'words', x: 400, y: 120, words: ['2', '3'], hi: [1], tags: ['ental'], size: 3 } ] },
        { cue: 'Tjugotre', els: [
          { k: 'circle', x: 276, y: 300, r: 10, tone: 'accent' },
          { k: 'text', t: '23', x: 276, y: 265, size: 1, tone: 'accent' },
          { k: 'arrow', x1: 252, y1: 236, x2: 104, y2: 270, bend: -0.45, tone: 'accent' } ] },
        { cue: 'Tjugosju', els: [
          { k: 'circle', x: 524, y: 300, r: 10, tone: 'cool' },
          { k: 'text', t: '27', x: 524, y: 265, size: 1, tone: 'cool' },
          { k: 'arrow', x1: 548, y1: 236, x2: 696, y2: 270, bend: 0.45, tone: 'cool' } ] },
        { cue: 'fem eller mer', els: [
          { k: 'mark', x: 372, y: 400, w: 330, h: 56 },
          { k: 'text', t: '5 eller mer → uppåt', x: 537, y: 440, size: 1 },
          { k: 'text', t: '0–4 → nedåt', x: 230, y: 440, size: 1, tone: 'muted' } ] },
      ],
    },
  },
  {
    id: 'g2', name: 'Adverbial', icon: 'chat',
    say: 'Adverbial', show: { type: 'term', word: 'Adverbial' },
    film: {
      say: 'Ett adverbial är en satsdel som berättar hur, när eller var något händer. Titta på meningen: Maja springer snabbt i skolan på morgonen. Snabbt säger hur. I skolan säger var. På morgonen säger när.',
      steps: [
        { cue: 'satsdel', els: [
          { k: 'text', t: 'Adverbial = en satsdel', x: 400, y: 80, size: 2, tone: 'accent' },
          { k: 'text', t: 'Hur? När? Var?', x: 400, y: 135, size: 1, tone: 'muted' } ] },
        { cue: 'Maja springer', els: [
          { k: 'words', x: 400, y: 280, words: ['Maja', 'springer', 'snabbt', 'i', 'skolan', 'på', 'morgonen.'], size: 2 } ] },
        { cue: 'Snabbt säger', els: [
          { k: 'words', x: 400, y: 280, words: ['Maja', 'springer', 'snabbt', 'i', 'skolan', 'på', 'morgonen.'], hi: [2], tags: ['hur?'], hiOnly: true, size: 2, tone: 'accent' } ] },
        { cue: 'I skolan säger', els: [
          { k: 'words', x: 400, y: 280, words: ['Maja', 'springer', 'snabbt', 'i', 'skolan', 'på', 'morgonen.'], hi: [3, 4], tags: ['var?'], hiOnly: true, size: 2, tone: 'cool' } ] },
        { cue: 'På morgonen säger', els: [
          { k: 'words', x: 400, y: 280, words: ['Maja', 'springer', 'snabbt', 'i', 'skolan', 'på', 'morgonen.'], hi: [5, 6], tags: ['när?'], hiOnly: true, size: 2, tone: 'warm' } ] },
      ],
    },
  },
  {
    id: 'g3', name: 'Från brott till dom', icon: 'scale',
    say: 'Från brott till dom', show: { type: 'term', word: 'Dom' },
    film: {
      say: 'När någon misstänks för ett brott gör polisen en förundersökning och samlar bevis. Räcker bevisen väcker åklagaren åtal. Då blir det rättegång i tingsrätten. Till sist kommer domstolen fram till en dom.',
      steps: [
        { cue: 'misstänks', els: [{ k: 'prop', n: 'person', x: 100, y: 220, s: 96, label: 'Misstanke', tone: 'muted' }] },
        { cue: 'förundersökning', els: [
          { k: 'arrow', x1: 158, y1: 220, x2: 232, y2: 220, flow: true, tone: 'muted' },
          { k: 'prop', n: 'magnifier', x: 290, y: 220, s: 96, label: 'Förundersökning', lp: 't', tone: 'accent' } ] },
        { cue: 'åtal', els: [
          { k: 'arrow', x1: 348, y1: 220, x2: 422, y2: 220, flow: true, tone: 'muted' },
          { k: 'prop', n: 'paper', x: 480, y: 220, s: 96, label: 'Åtal', tone: 'accent' } ] },
        { cue: 'rättegång', els: [
          { k: 'arrow', x1: 538, y1: 220, x2: 612, y2: 220, flow: true, tone: 'muted' },
          { k: 'prop', n: 'building', x: 680, y: 220, s: 104, label: 'Rättegång', lp: 't', tone: 'accent' } ] },
        { cue: 'en dom', els: [
          { k: 'arrow', x1: 680, y1: 290, x2: 560, y2: 385, bend: -0.3, flow: true, tone: 'muted' },
          { k: 'prop', n: 'gavel', x: 480, y: 400, s: 96, tone: 'alert' },
          { k: 'text', t: 'Dom', x: 400, y: 412, size: 2, a: 'e', tone: 'alert' } ] },
      ],
    },
  },
  {
    id: 'g4', name: 'Fotosyntes', icon: 'sun',
    say: 'Fotosyntes', show: { type: 'term', word: 'Fotosyntes' },
    film: {
      say: 'Fotosyntes är när växten gör sin egen mat. Den tar in ljus från solen, vatten från marken och koldioxid från luften. Av det tillverkar den socker, och syre släpps ut.',
      steps: [
        { cue: 'växten', els: [{ k: 'prop', n: 'plant', x: 400, y: 290, s: 210, tone: 'accent' }] },
        { cue: 'ljus', els: [
          { k: 'prop', n: 'sun', x: 120, y: 95, s: 110, tone: 'warm', label: 'Ljus', lp: 'r' },
          { k: 'arrow', x1: 175, y1: 140, x2: 330, y2: 210, flow: true, tone: 'warm' } ] },
        { cue: 'vatten', els: [
          { k: 'prop', n: 'drop', x: 160, y: 420, s: 70, tone: 'cool', label: 'Vatten', lp: 'r' },
          { k: 'arrow', x1: 200, y1: 420, x2: 375, y2: 400, bend: 0.2, flow: true, tone: 'cool' } ] },
        { cue: 'koldioxid', els: [
          { k: 'prop', n: 'cloud', x: 120, y: 270, s: 90, tone: 'muted', label: 'Koldioxid', lp: 'b' },
          { k: 'arrow', x1: 175, y1: 270, x2: 320, y2: 270, flow: true, tone: 'muted' } ] },
        { cue: 'socker', els: [
          { k: 'arrow', x1: 480, y1: 250, x2: 600, y2: 200, flow: true, tone: 'accent' },
          { k: 'box', x: 610, y: 165, w: 150, h: 64, label: 'Socker', tone: 'accent' } ] },
        { cue: 'syre', els: [
          { k: 'arrow', x1: 480, y1: 320, x2: 600, y2: 350, flow: true, tone: 'cool' },
          { k: 'box', x: 610, y: 320, w: 150, h: 64, label: 'Syre', tone: 'cool' } ] },
      ],
    },
  },
];
