#!/bin/sh
# Downloads raw inputs for the DRC location list into data/drc/raw (about 1.2 GB).
set -e
cd "$(dirname "$0")/../../data/drc" && mkdir -p raw && cd raw
HDX=https://data.humdata.org/dataset
curl -fL -o extents.gpkg "$HDX/24eee795-5b36-4c58-9521-2be12e21b285/resource/6bd78568-9e58-4e99-8495-da9d26142c19/download/grid3_cod_settlement_extents_v4.gpkg"
curl -fL -o names.gpkg "$HDX/47670d14-423e-4de9-944f-1df0bfc054f7/resource/5b869f08-4434-42a6-bcbc-d324c13b1bb2/download/grid3_cod_settlement_names_v9_0.gpkg"
curl -fL -o admin.geojson.zip "$HDX/f42132b9-8cc6-4201-b020-9259c56e8868/resource/97260e2b-65b1-41e3-aef2-fb0e6874e406/download/cod_admin_boundaries.geojson.zip"
unzip -o -q admin.geojson.zip -d admin
curl -fL -o pop.zip https://wopr.worldpop.org/download/613
unzip -o -q pop.zip
# GeoNames DRC places >= 1000 people, from the geonamescache package
pip download -q --no-deps -d . geonamescache && unzip -o -q geonamescache-*.whl 'geonamescache/data/cities1000.json'
python3 -c "
import json
d = json.load(open('geonamescache/data/cities1000.json'))
json.dump([dict(name=v['name'], lat=v['latitude'], lon=v['longitude'], population=v['population'], geonameid=v['geonameid'])
           for v in d.values() if v['countrycode'] == 'CD'], open('geonames_cd.json', 'w'))"
