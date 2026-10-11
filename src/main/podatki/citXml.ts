/**
 * The e-Deklaracje XML of a community's CIT-8 — what is filed with the tax office, signed with XAdES
 * (podpis/xades.ts) — with the CIT-8/O attachment when there is exempt income. The figures are the PDF's
 * (obliczCIT8), so the XML and the printed copy can never disagree.
 *
 * Element order and which positions appear follow the CIT-8 (34) / CIT-8/O (20) schemas (scripts/cit-xsd):
 *  • the schema's required positions are always written, as zeros where a community has nothing
 *    (P_60, P_76, P_112, P_138, P_146, P_148…), and the "nie" answers of parts B and L (P_26, P_33, P_315–P_321);
 *  • blocks a community never fills (P_116–119, P_133–137, the losses of the CIT-8/O) are left out whole —
 *    opening one would make its totals required;
 *  • where the form offers a choice (income or loss, tax to pay or overpayment) only one side is written.
 * Bytes in, text out: no Electron, checked against the schemas by scripts/cit-check.ts.
 */

import { CitSlownikRegula, PodatekCitDane } from '../../shared/types';
import { citWzor, obliczCIT8, opisProblemuCit, pozycjeZeSprawozdania, problemyCIT8Xml } from '../../shared/podatki-cit';
import { Wezel, duze, el, gr, kwota2, kwotaC, zlozXml } from './eDeklaracjeXml';

export interface Cit8XmlWejscie {
  rok: number;
  dane: PodatekCitDane;
  slownik: CitSlownikRegula[];
}

/** The CIT-8 of one return. Refuses — with the reasons — when something blocks the filing. */
export function cit8Xml(we: Cit8XmlWejscie): string {
  const { rok, dane: d, slownik } = we;
  const problemy = problemyCIT8Xml({ rok, dane: d }, slownik);
  if (problemy.length > 0) {
    throw new Error(`XML CIT-8 nie da się jeszcze wygenerować: ${problemy.map((p) => opisProblemuCit(p, rok)).join('; ')}.`);
  }
  const wzor = citWzor(rok)!;
  const w = obliczCIT8(d, pozycjeZeSprawozdania(d, slownik));
  const poz = (n: number): number => w.poz[n] ?? 0;
  const okresOd = `${rok}-01-01`;
  const okresDo = `${rok}-12-31`;

  const naglowek = gr('Naglowek', [
    el('KodFormularza', 'CIT-8', [
      ['kodSystemowy', wzor.cit8.kodSystemowy],
      ['kodPodatku', 'CIT'],
      ['rodzajZobowiazania', 'Z'],
      ['wersjaSchemy', wzor.cit8.wersjaSchemy],
    ]),
    el('WariantFormularza', String(wzor.cit8.wariant)),
    el('CelZlozenia', String(d.cel), [['poz', 'P_7']]),
    el('OkresOd', okresOd, [['poz', 'P_4']]),
    el('OkresDo', okresDo, [['poz', 'P_5']]),
    el('KodUrzedu', d.kodUrzedu),
  ]);

  const s = d.siedziba;
  const adres: Wezel[] = [
    el('KodKraju', 'PL'),
    el('Wojewodztwo', duze(s.wojewodztwo)),
    el('Powiat', duze(s.powiat)),
    el('Gmina', duze(s.gmina)),
    ...(s.ulica ? [el('Ulica', duze(s.ulica))] : []),
    el('NrDomu', s.nrDomu),
    ...(s.nrLokalu ? [el('NrLokalu', s.nrLokalu)] : []),
    el('Miejscowosc', duze(s.miejscowosc)),
    el('KodPocztowy', s.kodPocztowy),
  ];
  const podmiot = gr(
    'Podmiot1',
    [
      gr('OsobaNiefizyczna', [el('etd:NIP', d.nip), el('etd:PelnaNazwa', duze(d.nazwaPelna))]),
      gr('AdresSiedziby', [gr('AdresPol', adres)], [['rodzajAdresu', 'RAD']]),
    ],
    [['rola', 'Podatnik']],
  );

  const p: Wezel[] = [];
  const k2 = (n: number, v = poz(n)) => p.push(el(`P_${n}`, kwota2(v)));
  const kc = (n: number, v = poz(n)) => p.push(el(`P_${n}`, kwotaC(v)));
  const tak = (n: number | string, v: 1 | 2 | 3) => p.push(el(`P_${n}`, String(v)));

  /* B — data of the return */
  if (d.cel === 2 && d.rodzajKorekty !== null) tak(8, d.rodzajKorekty);
  tak(26, 3); // not under art. 25 ust. 11–16
  if (d.zaliczkiKwartalne) tak(28, 1);
  tak(33, 2); // no assets moved abroad
  /* C — attachments */
  if (w.cit8o) tak(40, 1);
  /* D.1, D.2 — income and costs (all of it "innych źródeł") */
  k2(53);
  k2(60, 0);
  k2(61);
  k2(63);
  k2(76, 0);
  k2(77);
  /* D.3 — income or loss */
  if (poz(81) > 0) k2(81);
  else k2(79);
  if (poz(87) > 0) k2(87);
  else k2(85);
  /* D.4 — nothing added or taken off, so the step after it is the same figure */
  if (poz(91) > 0) k2(91);
  else k2(93, 0);
  k2(95);
  /* E.1 — exempt income (CIT-8/O poz. 77) */
  k2(97);
  k2(99);
  k2(112, 0);
  k2(113);
  /* E.2 — the tax base or the loss */
  k2(114);
  if (poz(115) > 0) k2(115);
  k2(120);
  k2(131);
  if (poz(132) > 0) k2(132);
  /* F — the tax */
  kc(138);
  if (d.stawka === 19) {
    kc(139);
    tak('142_1', 1);
  } else {
    kc(140);
    tak('142_2', 1);
  }
  if (poz(141) > 0) k2(141);
  if (d.stawka === 19) k2(143);
  else k2(144);
  k2(146);
  kc(148);
  /*
   * G — advances. Each month is its own block in the schema, its "należna" before its "zapłacona"; the app has
   * only the paid advance, which is taken as the advance due too (as the PDF prints it).
   */
  d.zaliczki.forEach((z, i) => {
    if (!z || z <= 0) return;
    const m = i + 1;
    kc(m <= 6 ? 150 + m : 168 + m, z);
    kc(m <= 6 ? 168 + m : 186 + m, z);
  });
  kc(228);
  kc(246);
  if (poz(248) > 0) kc(248);
  else kc(247);
  kc(250);
  /* H — to pay, or overpaid */
  if (poz(260) > 0) kc(260);
  else kc(259);
  /* L — the closing questions, all "nie" for a community */
  for (const n of [315, 316, 317, 318, 320, 321]) tak(n, 2);

  const zalaczniki: Wezel[] = [];
  if (w.cit8o) {
    const o = (nazwa: string) => `cz8o:${nazwa}`;
    const zw = kwota2(w.dochodZwolniony);
    const zero = kwota2(0);
    zalaczniki.push(
      gr(o('Zalacznik_CIT-8_O'), [
        gr(o('Naglowek'), [
          el(o('KodFormularza'), 'CIT-8/O', [
            ['kodSystemowy', wzor.cit8o.kodSystemowy],
            ['wersjaSchemy', wzor.cit8o.wersjaSchemy],
          ]),
          el(o('WariantFormularza'), String(wzor.cit8o.wariant)),
          el(o('OkresOd'), okresOd, [['poz', 'P_4']]),
          el(o('OkresDo'), okresDo, [['poz', 'P_5']]),
        ]),
        gr(o('PozycjeSzczegolowe'), [
          // Art. 17 ust. 1 pkt 44 — housing communities; the same figure is the attachment's total.
          el(o('P_38'), zw),
          el(o('P_77'), zw),
          ...[156, 157, 158, 159, 164, 165, 187].map((n) => el(o(`P_${n}`), zero)),
        ]),
      ]),
    );
  }

  const korzen = gr('Deklaracja', [
    naglowek,
    podmiot,
    gr('PozycjeSzczegolowe', p),
    el('Pouczenia', '1'),
    ...(zalaczniki.length > 0 ? [gr('Zalaczniki', zalaczniki)] : []),
  ]);
  return zlozXml(
    korzen,
    ` xmlns="${wzor.cit8.ns}" xmlns:etd="${wzor.cit8.etdNs}"${w.cit8o ? ` xmlns:cz8o="${wzor.cit8o.ns}"` : ''}`,
  );
}
