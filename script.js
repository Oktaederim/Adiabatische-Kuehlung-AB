document.addEventListener('DOMContentLoaded', () => {

    const dom = {
        // Inputs
        tempAbluft: document.getElementById('tempAbluft'), rhAbluft: document.getElementById('rhAbluft'),
        tempZuluft: document.getElementById('tempZuluft'), rhZuluft: document.getElementById('rhZuluft'),
        volumenstrom: document.getElementById('volumenstrom'), druck: document.getElementById('druck'),
        etaBefeuchter: document.getElementById('etaBefeuchter'), etaWRG: document.getElementById('etaWRG'),
        etaBefeuchterValue: document.getElementById('etaBefeuchterValue'), etaWRGValue: document.getElementById('etaWRGValue'),
        resetBtn: document.getElementById('resetBtn'),

        // Summary Outputs
        summaryPower: document.getElementById('summary-power'),
        summaryWater: document.getElementById('summary-water'),
        summaryZuluftDeltaT: document.getElementById('summary-zuluft-delta-t'),

        // --- NEUE DOM-ELEMENTE FÜR ZWISCHENBILANZEN ---
        compAdiabat: { t: document.getElementById('comp-t-ab'), w: document.getElementById('res-w-adiabat') },
        compWRG: { p: document.getElementById('res-p-wrg'), tZu: document.getElementById('comp-t-zu'), tAb: document.getElementById('comp-t-wrg-ab') },
    };

    const allInputs = document.querySelectorAll('input');
    storeInitialValues();

    const RHO_LUFT = 1.2;
    
    // --- Psychrometrische Funktionen (unverändert) ---
    function getPs(T) { return 611.2 * Math.exp((17.62 * T) / (243.12 + T)); }
    function getX(T, rH, p) { const ps = getPs(T); const pv = (rH / 100) * ps; return 622 * (pv / (p - pv)); }
    function getRh(T, x, p) { const ps = getPs(T); const pv = (p * x) / (622 + x); return Math.min(100, (pv / ps) * 100); }
    function getH(T, x_g_kg) { const x_kg_kg = x_g_kg / 1000.0; return 1.006 * T + x_kg_kg * (2501 + 1.86 * T); }
    function getTd(x, p) { const pv = (p * x) / (622 + x); return (243.12 * Math.log(pv / 611.2)) / (17.62 - Math.log(pv / 611.2)); }
    function getTwb(T, x, p) {
        const h_target = getH(T, x);
        if (isNaN(h_target)) return NaN;
        let low = getTd(x, p), high = T;
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

    // --- Hauptberechnungsfunktion (Logik unverändert) ---
    function calculate() {
        try {
            const inputs = {
                tAb: parseFloat(dom.tempAbluft.value), rhAb: parseFloat(dom.rhAbluft.value),
                tZu: parseFloat(dom.tempZuluft.value), rhZu: parseFloat(dom.rhZuluft.value),
                vol: parseFloat(dom.volumenstrom.value), p: (parseFloat(dom.druck.value) || 1013.25) * 100,
                etaB: parseFloat(dom.etaBefeuchter.value) / 100,
                etaW: parseFloat(dom.etaWRG.value) / 100,
            };

            const massenstrom = (inputs.vol / 3600) * RHO_LUFT;

            const abluft_in = { t: inputs.tAb, rh: inputs.rhAb };
            abluft_in.x = getX(abluft_in.t, abluft_in.rh, inputs.p);
            abluft_in.h = getH(abluft_in.t, abluft_in.x);
            abluft_in.twb = getTwb(abluft_in.t, abluft_in.x, inputs.p);
            
            const abluft_mid = {};
            abluft_mid.t = abluft_in.t - (inputs.etaB * (abluft_in.t - abluft_in.twb));
            abluft_mid.h = abluft_in.h;
            abluft_mid.x = 1000 * (abluft_mid.h - 1.006 * abluft_mid.t) / (2501 + 1.86 * abluft_mid.t);
            abluft_mid.rh = getRh(abluft_mid.t, abluft_mid.x, inputs.p);

            const wasser_l_h = massenstrom * ((abluft_mid.x - abluft_in.x) / 1000) * 3600;

            const zuluft_in = { t: inputs.tZu, rh: inputs.rhZu };
            zuluft_in.x = getX(zuluft_in.t, zuluft_in.rh, inputs.p);
            zuluft_in.h = getH(zuluft_in.t, zuluft_in.x);

            const zuluft_out = {};
            zuluft_out.t = zuluft_in.t - (inputs.etaW * (zuluft_in.t - abluft_mid.t));
            zuluft_out.x = zuluft_in.x;
            zuluft_out.h = getH(zuluft_out.t, zuluft_out.x);
            zuluft_out.rh = getRh(zuluft_out.t, zuluft_out.x, inputs.p);

            const leistung = massenstrom * (zuluft_in.h - zuluft_out.h);
            
            const abluft_out = {};
            abluft_out.h = abluft_mid.h + (zuluft_in.h - zuluft_out.h);
            abluft_out.x = abluft_mid.x;
            abluft_out.t = (abluft_out.h - abluft_out.x / 1000 * 2501) / (1.006 + abluft_out.x / 1000 * 1.86);
            abluft_out.rh = getRh(abluft_out.t, abluft_out.x, inputs.p);
            
            render({ zuluft_in, zuluft_out, abluft_in, abluft_mid, abluft_out, leistung, wasser_l_h });

        } catch (error) { console.error("Berechnungsfehler:", error); }
    }

    // --- STARK ANGEPASSTE Render-Funktion ---
    function render(data) {
        const f = (num, dec = 1) => isNaN(num) ? '--' : num.toLocaleString('de-DE', { minimumFractionDigits: dec, maximumFractionDigits: dec });

        // Summary
        dom.summaryPower.textContent = `${f(data.leistung, 1)} kW`;
        dom.summaryWater.textContent = `${f(data.wasser_l_h, 2)} l/h`;
        dom.summaryZuluftDeltaT.textContent = `${f(data.zuluft_in.t)}°C → ${f(data.zuluft_out.t)}°C`;
        
        // Komponenten mit Zwischenbilanzen
        dom.compAdiabat.t.innerHTML = `T: ${f(data.abluft_in.t)}°C ↘ ${f(data.abluft_mid.t)}°C`;
        dom.compAdiabat.w.innerHTML = `Wasser: <strong>${f(data.wasser_l_h, 2)} l/h</strong>`;
        
        dom.compWRG.p.innerHTML = `Kälteleistung: <strong>${f(data.leistung, 1)} kW</strong>`;
        dom.compWRG.tZu.innerHTML = `Zuluft T: ${f(data.zuluft_in.t)}°C ↘ ${f(data.zuluft_out.t)}°C`;
        dom.compWRG.tAb.innerHTML = `Abluft T: ${f(data.abluft_mid.t)}°C ↗ ${f(data.abluft_out.t)}°C`;
        
        // Prozessknoten aktualisieren
        const updateNode = (id, state) => {
            document.getElementById(`res-t-${id}`).textContent = f(state.t);
            document.getElementById(`res-rh-${id}`).textContent = f(state.rh);
            document.getElementById(`res-x-${id}`).textContent = f(state.x, 2);
        };
        updateNode('zu-in', data.zuluft_in);
        updateNode('zu-out', data.zuluft_out);
        updateNode('ab-in', data.abluft_in);
        updateNode('ab-mid', data.abluft_mid);
        updateNode('ab-out', data.abluft_out);
    }

    // --- Event Listeners (unverändert) ---
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

    handleInputChange();
});
