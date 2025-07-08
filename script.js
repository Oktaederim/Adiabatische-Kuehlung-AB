document.addEventListener('DOMContentLoaded', () => {

    // --- DOM-Elemente ---
    const dom = {
        // Inputs
        tempAbluft: document.getElementById('tempAbluft'),
        rhAbluft: document.getElementById('rhAbluft'),
        tempZuluft: document.getElementById('tempZuluft'),
        rhZuluft: document.getElementById('rhZuluft'),
        volumenstrom: document.getElementById('volumenstrom'),
        druck: document.getElementById('druck'),
        etaBefeuchter: document.getElementById('etaBefeuchter'),
        etaWRG: document.getElementById('etaWRG'),
        etaBefeuchterValue: document.getElementById('etaBefeuchterValue'),
        etaWRGValue: document.getElementById('etaWRGValue'),
        resetBtn: document.getElementById('resetBtn'),

        // Summary Outputs
        summaryPower: document.getElementById('summary-power'),
        summaryWater: document.getElementById('summary-water'),
        summaryZuluftDeltaT: document.getElementById('summary-zuluft-delta-t'),

        // Process Components
        compAdiabat: { w: document.getElementById('res-w-adiabat') },
        compWRG: { p: document.getElementById('res-p-wrg') },
        compWRGab: { p: document.getElementById('res-p-wrg-ab') },
        
        // Process States
        nodes: {
            zuIn: document.getElementById('node-zu-in'), zuOut: document.getElementById('node-zu-out'),
            abIn: document.getElementById('node-ab-in'), abMid: document.getElementById('node-ab-mid'), abOut: document.getElementById('node-ab-out')
        }
    };

    const allInputs = document.querySelectorAll('input');
    storeInitialValues();

    // --- Konstanten ---
    const RHO_LUFT = 1.2; // Dichte trockener Luft in kg/m³
    
    // --- Physikalische Berechnungsfunktionen (Psychrometrie) ---
    function getPs(T) { return 611.2 * Math.exp((17.62 * T) / (243.12 + T)); }
    function getX(T, rH, p) { const ps = getPs(T); const pv = (rH / 100) * ps; return 622 * (pv / (p - pv)); }
    function getRh(T, x, p) { const ps = getPs(T); const pv = (p * x) / (622 + x); return Math.min(100, (pv / ps) * 100); }
    function getTd(x, p) { const pv = (p * x) / (622 + x); return (243.12 * Math.log(pv / 611.2)) / (17.62 - Math.log(pv / 611.2)); }
    function getH(T, x_g_kg) { const x_kg_kg = x_g_kg / 1000.0; return 1.006 * T + x_kg_kg * (2501 + 1.86 * T); }
    function getTwb(T, x, p) {
        const h_target = getH(T, x);
        if (isNaN(h_target)) return NaN;
        let low = getTd(x, p);
        let high = T;
        if (high - low < 0.01) return T;
        for (let i = 0; i < 15; i++) {
            let mid = (low + high) / 2;
            let x_s_mid = getX(mid, 100, p);
            if (isNaN(x_s_mid)) return NaN;
            let h_mid = getH(mid, x_s_mid);
            if (h_mid < h_target) { low = mid; } else { high = mid; }
        }
        return (low + high) / 2;
    }

    // --- Hauptberechnungsfunktion ---
    function calculate() {
        try {
            // 1. Inputs einlesen
            const inputs = {
                tAb: parseFloat(dom.tempAbluft.value), rhAb: parseFloat(dom.rhAbluft.value),
                tZu: parseFloat(dom.tempZuluft.value), rhZu: parseFloat(dom.rhZuluft.value),
                vol: parseFloat(dom.volumenstrom.value), p: (parseFloat(dom.druck.value) || 1013.25) * 100,
                etaB: parseFloat(dom.etaBefeuchter.value) / 100,
                etaW: parseFloat(dom.etaWRG.value) / 100,
            };

            // 2. Massenstrom berechnen
            const massenstrom = (inputs.vol / 3600) * RHO_LUFT;

            // 3. Zustand 1: Abluft Eintritt
            const abluft_in = {};
            abluft_in.t = inputs.tAb;
            abluft_in.rh = inputs.rhAb;
            abluft_in.x = getX(abluft_in.t, abluft_in.rh, inputs.p);
            abluft_in.h = getH(abluft_in.t, abluft_in.x);
            abluft_in.twb = getTwb(abluft_in.t, abluft_in.x, inputs.p);
            
            // 4. Zustand 2: Abluft nach adiabatischer Kühlung
            const abluft_mid = {};
            abluft_mid.t = abluft_in.t - (inputs.etaB * (abluft_in.t - abluft_in.twb));
            abluft_mid.h = abluft_in.h; // Isenthalper Prozess
            // Absolute Feuchte aus T und h berechnen
            abluft_mid.x = 1000 * (abluft_mid.h - 1.006 * abluft_mid.t) / (2501 + 1.86 * abluft_mid.t);
            abluft_mid.rh = getRh(abluft_mid.t, abluft_mid.x, inputs.p);

            // 5. Wasserverbrauch berechnen
            const delta_x = abluft_mid.x - abluft_in.x;
            const wasser_kg_s = massenstrom * (delta_x / 1000);
            const wasser_l_h = wasser_kg_s * 3600; // 1 kg/s = 3600 l/h

            // 6. Zustand 3: Zuluft Eintritt
            const zuluft_in = {};
            zuluft_in.t = inputs.tZu;
            zuluft_in.rh = inputs.rhZu;
            zuluft_in.x = getX(zuluft_in.t, zuluft_in.rh, inputs.p);
            zuluft_in.h = getH(zuluft_in.t, zuluft_in.x);

            // 7. Zustand 4: Zuluft nach WRG
            const zuluft_out = {};
            zuluft_out.t = zuluft_in.t - (inputs.etaW * (zuluft_in.t - abluft_mid.t));
            zuluft_out.x = zuluft_in.x; // Keine Feuchteübertragung im KVS
            zuluft_out.h = getH(zuluft_out.t, zuluft_out.x);
            zuluft_out.rh = getRh(zuluft_out.t, zuluft_out.x, inputs.p);

            // 8. Kälteleistung berechnen
            const leistung = massenstrom * (zuluft_in.h - zuluft_out.h);
            
            // 9. Zustand 5: Fortluft (Abluft nach WRG)
            const abluft_out = {};
            const delta_h_zu = zuluft_in.h - zuluft_out.h;
            abluft_out.h = abluft_mid.h + delta_h_zu;
            abluft_out.x = abluft_mid.x;
            // Temperatur aus h und x berechnen
            abluft_out.t = (abluft_out.h - abluft_out.x / 1000 * 2501) / (1.006 + abluft_out.x / 1000 * 1.86);
            abluft_out.rh = getRh(abluft_out.t, abluft_out.x, inputs.p);
            
            // 10. Alle Werte in die UI schreiben
            render({ zuluft_in, zuluft_out, abluft_in, abluft_mid, abluft_out, leistung, wasser_l_h });

        } catch (error) {
            console.error("Berechnungsfehler:", error);
        }
    }

    // --- Render-Funktion ---
    function render(data) {
        // Summary
        dom.summaryPower.textContent = `${format(data.leistung, 1)} kW`;
        dom.summaryWater.textContent = `${format(data.wasser_l_h, 2)} l/h`;
        dom.summaryZuluftDeltaT.textContent = `${format(data.zuluft_in.t, 1)}°C → ${format(data.zuluft_out.t, 1)}°C`;
        
        // Komponenten
        dom.compAdiabat.w.textContent = `${format(data.wasser_l_h, 2)} l/h`;
        dom.compWRG.p.textContent = `${format(data.leistung, 1)} kW`;
        dom.compWRGab.p.textContent = `${format(data.leistung, 1)} kW`;
        
        // Prozessknoten aktualisieren
        updateNode('zu-in', data.zuluft_in);
        updateNode('zu-out', data.zuluft_out);
        updateNode('ab-in', data.abluft_in);
        updateNode('ab-mid', data.abluft_mid);
        updateNode('ab-out', data.abluft_out);
    }

    function updateNode(id, state) {
        document.getElementById(`res-t-${id}`).textContent = format(state.t, 1);
        document.getElementById(`res-rh-${id}`).textContent = format(state.rh, 1);
        document.getElementById(`res-x-${id}`).textContent = format(state.x, 2);
        document.getElementById(`res-h-${id}`).textContent = format(state.h, 2);
    }
    
    function format(num, dec = 0) { return isNaN(num) ? '--' : num.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec }); }

    // --- Event Listeners ---
    function handleInputChange() {
        dom.etaBefeuchterValue.textContent = dom.etaBefeuchter.value;
        dom.etaWRGValue.textContent = dom.etaWRG.value;
        calculate();
    }
    
    function storeInitialValues() { allInputs.forEach(el => el.dataset.defaultValue = el.value); }
    function resetToDefaults() {
        allInputs.forEach(el => el.value = el.dataset.defaultValue);
        handleInputChange();
    }

    allInputs.forEach(input => input.addEventListener('input', handleInputChange));
    dom.resetBtn.addEventListener('click', resetToDefaults);

    // Initial calculation on page load
    handleInputChange();
});
