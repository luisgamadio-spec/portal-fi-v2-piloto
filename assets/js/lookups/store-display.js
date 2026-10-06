/* PORTAL-NEXT V2 -- store canonical-code -> display-name lookup.

   Presentation only. Store IDENTITY (equality, filtering, grouping,
   authorization, selector `value`) belongs to the backend's canonical
   short codes (operational_fandi_dashboard's `store` field -- proven in
   Wave 1: ABC/ALPHAVILLE/ANALIA FRANCO/BANDEIRANTES/BARRA FUNDA/EUROPA/
   GASTAO/NACOES, no accents, no brand prefix). This module NEVER
   normalizes, compares, or authorizes a store -- it only turns an
   already-canonical code into the label a person reads. Consumed by
   render code only; never imported by an adapter or a fixture provider. */
(function () {
  'use strict';

  var STORE_DISPLAY = {
    ABC: 'ABC',
    ALPHAVILLE: 'Alphaville',
    'ANALIA FRANCO': 'Anália Franco',
    BANDEIRANTES: 'Bandeirantes',
    'BARRA FUNDA': 'Barra Funda',
    EUROPA: 'Europa',
    GASTAO: 'Gastão Vidigal',
    NACOES: 'Nações Unidas',
    ALL: 'Todas as lojas'
  };

  var CANONICAL_STORES = ['ABC', 'ALPHAVILLE', 'ANALIA FRANCO', 'BANDEIRANTES', 'BARRA FUNDA', 'EUROPA', 'GASTAO', 'NACOES'];

  function storeDisplayName(code) {
    if (code == null || code === '') return STORE_DISPLAY.ALL;
    return Object.prototype.hasOwnProperty.call(STORE_DISPLAY, code) ? STORE_DISPLAY[code] : String(code);
  }

  window.NX_STORE_DISPLAY = {
    STORE_DISPLAY: STORE_DISPLAY,
    CANONICAL_STORES: CANONICAL_STORES,
    storeDisplayName: storeDisplayName
  };
})();
