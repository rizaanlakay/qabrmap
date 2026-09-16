# Cemetery outlines to draw in OpenStreetMap

These 11 sites are live in QabrMap but have no boundary. Drawing them in OpenStreetMap
rather than in a private file means the outline is ODbL licensed, the whole map benefits, and our
importer picks it up automatically: run `node tools/burial-sites/resolve.mjs --outlines-only`
then `node tools/burial-sites/upsert.mjs` and the boundary appears in the app.

## Before you start

You need a free account at https://www.openstreetmap.org. The Edit links below open the iD editor
at the site.

**Never trace from Google.** Google Maps, Google Earth and Street View are off limits as sources for
OpenStreetMap, and so are their place names. Copying from them gets changesets reverted and is a
copyright breach. Use the editor default imagery (Bing, Esri or Maxar), which is licensed for this.
For names use the Muslim Judicial Council directory, municipal listings, signage or your own
knowledge. Some names in our own database came from Google Places, so do not copy them back.

## How to tag each one

Draw the area around the burial ground, then tag it:

```
landuse=cemetery        (or amenity=grave_yard if it adjoins a mosque)
religion=muslim
name=<the community name, not Google's>
```

Our importer looks for landuse=cemetery or amenity=grave_yard within 400 m of the point below, so
check the point is actually on the right ground before drawing. Add a changeset comment such as
"Add Muslim cemetery boundary from imagery".

## The sites

### 1. Mitchell’s Plain/Khayelitsha Muslim Cemetery (Swartklip)

- Where: Mitchells Plain / Khayelitsha, Western Cape (Corner of Steve Biko Road and Swartklip Road, Khayelitsha, Cape Town)
- Our point: `-34.050096, 18.673800`
- Edit: https://www.openstreetmap.org/edit#map=18/-34.050096/18.673800
- Look first: https://www.openstreetmap.org/#map=18/-34.050096/18.673800
- [ ] drawn

### 2. Atlantis Cemetery

- Where: Atlantis, Western Cape (266 Dassenberg Street, Cape Farms District B, Atlantis, Cape Town)
- Our point: `-33.539886, 18.490294`
- Edit: https://www.openstreetmap.org/edit#map=18/-33.539886/18.490294
- Look first: https://www.openstreetmap.org/#map=18/-33.539886/18.490294
- [ ] drawn

### 3. Ocean View Cemetery

- Where: Ocean View, Western Cape (Jupiter Road, Ocean View, Cape Town)
- Our point: `-34.156194, 18.356026`
- Edit: https://www.openstreetmap.org/edit#map=18/-34.156194/18.356026
- Look first: https://www.openstreetmap.org/#map=18/-34.156194/18.356026
- [ ] drawn

### 4. Tana Baru Cemetery

- Where: Bo-Kaap, Western Cape (Dawes Street / top of Longmarket Street, Bo-Kaap, Cape Town)
- Our point: `-33.918325, 18.415158`
- Edit: https://www.openstreetmap.org/edit#map=18/-33.918325/18.415158
- Look first: https://www.openstreetmap.org/#map=18/-33.918325/18.415158
- [ ] drawn

### 5. Springs Memorial Cemetery

- Where: Springs, Gauteng (Pietersfield, Springs, Gauteng)
- Our point: `-26.227940, 28.456200`
- Note: OSM way/423952945 is Payneville, a differently named cemetery, and it does not contain our point.
- Edit: https://www.openstreetmap.org/edit#map=18/-26.227940/28.456200
- Look first: https://www.openstreetmap.org/#map=18/-26.227940/28.456200
- [ ] drawn

### 6. Al-Hilal Muslim Cemetery

- Where: Durban, KwaZulu-Natal (10 Sheringham Road, Sydenham, Berea, Durban, 4091)
- Our point: `-29.831446, 30.998587`
- Note: OSM way/436673425 is The Hartley Estate Tamil and Telugu Cemetery, a different community entirely. Draw the Muslim ground beside it.
- Edit: https://www.openstreetmap.org/edit#map=18/-29.831446/30.998587
- Look first: https://www.openstreetmap.org/#map=18/-29.831446/30.998587
- [ ] drawn

### 7. Port Shepstone Muslim Cemetery

- Where: Port Shepstone, KwaZulu-Natal (51 Bazley Street, Port Shepstone, 4240)
- Our point: `-30.738529, 30.446947`
- Edit: https://www.openstreetmap.org/edit#map=18/-30.738529/30.446947
- Look first: https://www.openstreetmap.org/#map=18/-30.738529/30.446947
- [ ] drawn

### 8. West Coast Islamic Society Maqbara

- Where: Saldanha / Vredenburg, Western Cape (Saldanha Road, between Saldanha and Vredenburg)
- Our point: `-32.911004, 17.999580`
- Edit: https://www.openstreetmap.org/edit#map=18/-32.911004/17.999580
- Look first: https://www.openstreetmap.org/#map=18/-32.911004/17.999580
- [ ] drawn

### 9. Verulam & District Muslim Cemetery

- Where: Verulam, KwaZulu-Natal (Townview Road, Canelands, Verulam, 4339)
- Our point: `-29.637487, 31.051183`
- Edit: https://www.openstreetmap.org/edit#map=18/-29.637487/31.051183
- Look first: https://www.openstreetmap.org/#map=18/-29.637487/31.051183
- [ ] drawn

### 10. Mangaung Municipal Cemetery (Muslim burial area)

- Where: Bloemfontein, Free State (Bloemfontein, Mangaung)
- Our point: `-29.125840, 26.217710`
- Edit: https://www.openstreetmap.org/edit#map=18/-29.125840/26.217710
- Look first: https://www.openstreetmap.org/#map=18/-29.125840/26.217710
- [ ] drawn

### 11. Lebohang Ext. 14 Muslim Cemetery

- Where: Leslie / Lebohang, Mpumalanga (Lebohang Ext. 14, Govan Mbeki Municipality)
- Our point: `-26.379496, 28.920839`
- Edit: https://www.openstreetmap.org/edit#map=18/-26.379496/28.920839
- Look first: https://www.openstreetmap.org/#map=18/-26.379496/28.920839
- [ ] drawn
