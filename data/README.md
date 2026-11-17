# Public reference food data

`cofid-2021.json` contains 2,887 food names and calorie/macronutrient values extracted from
[CoFID 2021, Public Health England](https://www.gov.uk/government/publications/composition-of-foods-integrated-dataset-cofid),
under the [Open Government Licence v3.0](https://www.nationalarchives.gov.uk/doc/open-government-licence/version/3/).
Contains public sector information licensed under the Open Government Licence v3.0.

Run `python3 scripts/import-cofid.py /path/to/CoFID.xlsx` to reproduce the extract from the linked spreadsheet.
Only numeric cells are extracted. Tr (trace), N (unknown), and blank cells stay null. AOAC fibre is used, not NSP.
The source expresses nutrition per 100 g except alcoholic beverages (per 100 ml). Specific gravity, where supplied,
is used for volume conversion. Approximate drink densities and named edible portion weights are clearly marked estimates
in the app, and are application assumptions rather than values supplied by CoFID. Metric cups are 250 ml; UK fluid ounces are 28.413 ml.
Foods keep their cooking/preparation names. The dataset loads on the server; it is not shipped in the mobile JavaScript bundle.

Branded product results come separately from [Open Food Facts](https://world.openfoodfacts.org),
licensed under ODbL with individual contents under the Database Contents License.
No private diary, custom food, favourite or photo is uploaded to Open Food Facts. Catalogue search terms are sent
only to search public products. Public provider responses are cached separately from private user food records.
