"use strict";

// Menu content for אייכה בר (Eicha Bar), Harish.
// Primary language Hebrew; English + Arabic supported.
//
// Category: { id, icon, title: {he,en,ar}, note?: {he,en,ar}, items: [...] }
//   - note: optional line shown under the category title (e.g. serving-size or
//     shared pricing explanation).
// Item:     { he, en, ar, price, note?: {he,en,ar}, badges?, image?, available? }
//   - price: a number in ₪ (NIS), OR a string for variants/ranges, e.g.
//     "52/208" (glass / pitcher), "30/34" (third / half liter),
//     "49/139" (glass / bottle). null = price not set yet (ask owner).
//   - badges: array of keys → highlight chips. Allowed: "new", "mustTry".
//     An item may carry both, e.g. badges: ["new", "mustTry"]. See BADGES below.
//   - note: optional localized sub-line (description, condition, etc.).
//   - image: optional photo path; absent → assets/menu-item-placeholder.svg.
//   - available: optional; false = show as sold out.
//
// To flag an item, add e.g.  badges: ["mustTry"]  (or ["new", "mustTry"]).

const BADGES = {
  new:     { he: "חדש", en: "New", ar: "جديد" },
  mustTry: { he: "חובה לטעום", en: "Must try", ar: "يجب تجربته" },
};

const CATEGORIES = [
  {
    id: "starters",
    icon: "🥔",
    title: { he: "ראשונות", en: "Starters", ar: "المقبلات" },
    items: [
      {
        he: "האש בראונס",
        en: "Hash Browns",
        ar: "هاش براون",
        price: 44,
        // badges: ["mustTry"], // ← example: uncomment to flag this item
        note: {
          he: "קוביות תפו״א בחמאה עם בצל, מעט צ'ילי ושומשום",
          en: "Potato cubes in butter with onion, a touch of chili and sesame",
          ar: "مكعّبات بطاطا بالزبدة مع البصل، قليل من الفلفل الحار والسمسم",
        },
      },
      {
        he: "האש בראונס מוקרם",
        en: "Creamed Hash Browns",
        ar: "هاش براون بالكريمة",
        price: 48,
        note: {
          he: "קוביות תפו״א בחמאה עם בצל, מעט צ'ילי ושומשום, מוקרם",
          en: "Potato cubes in butter with onion, a touch of chili and sesame, creamed",
          ar: "مكعّبات بطاطا بالزبدة مع البصل، قليل من الفلفل الحار والسمسم، بالكريمة",
        },
      },
      {
        he: "תפו״א מדורה",
        en: "Campfire Potato",
        ar: "بطاطا على الجمر",
        price: 42,
        note: {
          he: "תפו״א שלם מוקרם, מוגש עם סלט ירוק",
          en: "Whole creamed potato, served with a green salad",
          ar: "حبة بطاطا كاملة بالكريمة، تُقدّم مع سلطة خضراء",
        },
      },
      {
        he: "כרוב צלוי על טחינת סלק",
        en: "Roasted Cabbage over Beet Tahini",
        ar: "ملفوف مشوي على طحينة الشمندر",
        price: 42,
        note: {
          he: "סטייק כרוב מתקתק בטחינה וסילאן, בליווי טחינה סגולה ושקדים קלויים",
          en: "Sweet cabbage steak with tahini and date syrup, with purple beet tahini and roasted almonds",
          ar: "شريحة ملفوف حلوة بالطحينة ودبس التمر، مع طحينة الشمندر الأرجوانية واللوز المحمّص",
        },
      },
      {
        he: "חציל פתוח בטחינה",
        en: "Open Eggplant with Tahini",
        ar: "باذنجان مشوي بالطحينة",
        price: 48,
        note: {
          he: "חציל צלוי מוגש עם טחינה, שברי פיסטוק ופטרוזיליה טרייה, לצד רצועות לחם",
          en: "Roasted eggplant with tahini, crushed pistachios and fresh parsley, with bread strips",
          ar: "باذنجان مشوي مع الطحينة وفتات الفستق والبقدونس الطازج، مع أصابع الخبز",
        },
      },
    ],
  },

  {
    id: "salads",
    icon: "🥗",
    title: { he: "סלטים", en: "Salads", ar: "السلطات" },
    note: {
      he: "תוספת גבינת פטה או ביצה רכה — 5 ₪",
      en: "Add feta cheese or a soft-boiled egg — ₪5",
      ar: "إضافة جبنة فيتا أو بيضة طريّة — 5 ₪",
    },
    items: [
      {
        he: "סלט זוקיני",
        en: "Zucchini Salad",
        ar: "سلطة الكوسا",
        price: 46,
        note: {
          he: "זוקיני, בצל סגול, רוקט, פרמז'ן ושקדים קלויים",
          en: "Zucchini, red onion, arugula, parmesan and roasted almonds",
          ar: "كوسا، بصل أحمر، جرجير، بارميزان ولوز محمّص",
        },
      },
      {
        he: "סלט יווני",
        en: "Greek Salad",
        ar: "سلطة يونانية",
        price: 56,
        note: {
          he: "חסה, מלפפון, בצל סגול, עגבניה, גמבה, זיתי קלמטה וגבינת פטה ברוטב שמן זית-לימון",
          en: "Lettuce, cucumber, red onion, tomato, bell pepper, Kalamata olives and feta in a lemon–olive-oil dressing",
          ar: "خس، خيار، بصل أحمر، طماطم، فلفل حلو، زيتون كالاماتا وجبنة فيتا مع صلصة زيت الزيتون والليمون",
        },
      },
      {
        he: "סלט ירוקים",
        en: "Green Salad",
        ar: "سلطة خضراء",
        price: 46,
        note: {
          he: "מיקס עלים, שרי, בצל סגול, מלפפון, גזר, כרוב לבן, פרי העונה ושקדים קלויים ברוטב ויניגרט חרדל-בלסמי",
          en: "Mixed greens, cherry tomatoes, red onion, cucumber, carrot, white cabbage, seasonal fruit and roasted almonds in a mustard-balsamic vinaigrette",
          ar: "خليط أوراق خضراء، طماطم كرزية، بصل أحمر، خيار، جزر، ملفوف أبيض، فاكهة الموسم ولوز محمّص مع صلصة الخردل والبلسميك",
        },
      },
      {
        he: "סלט ניסואז",
        en: "Niçoise Salad",
        ar: "سلطة نيسواز",
        price: 58,
        note: {
          he: "מבחר ירקות טריים, ביצה קשה, תפוחי אדמה, שעועית, טונה ורוטב איולי פרמז'ן",
          en: "An assortment of fresh vegetables, hard-boiled egg, potatoes, green beans, tuna and a parmesan aioli",
          ar: "تشكيلة خضار طازجة، بيض مسلوق، بطاطا، فاصولياء خضراء، تونة وصلصة أيولي بالبارميزان",
        },
      },
    ],
  },

  {
    id: "pasta",
    icon: "🍝",
    title: { he: "פסטות", en: "Pasta", ar: "المعكرونة" },
    items: [
      {
        he: "רביולי גבינות",
        en: "Cheese Ravioli",
        ar: "رافيولي بالجبن",
        price: 68,
        note: {
          he: "מוגש ברוטב לבחירה: שמנת-פטריות, רוזה, גבינות או פסטו, בליווי פרמז'ן",
          en: "Served in your choice of mushroom-cream, rosé, cheese or pesto sauce, with parmesan",
          ar: "تُقدّم بصلصة على الاختيار: فطر بالكريمة، روزيه، جبن أو بيستو، مع البارميزان",
        },
      },
      {
        he: "פסטה פטוצ'יני",
        en: "Fettuccine",
        ar: "فيتوتشيني",
        price: 54,
        note: {
          he: "מוגש ברוטב לבחירה: שמנת-פטריות, רוזה, עגבניות או פסטו, בליווי פרמז'ן",
          en: "Served in your choice of mushroom-cream, rosé, tomato or pesto sauce, with parmesan",
          ar: "تُقدّم بصلصة على الاختيار: فطر بالكريمة، روزيه، طماطم أو بيستو، مع البارميزان",
        },
      },
    ],
  },

  {
    id: "oven",
    icon: "🔥",
    title: { he: "חם מהתנור", en: "Hot from the Oven", ar: "ساخن من الفرن" },
    items: [
      {
        he: "לחם הבית",
        en: "House Bread",
        ar: "خبز البيت",
        price: 36,
        note: {
          he: "פוקאצ'ה איטלקית אוורירית מוגשת חמה, בליווי חמישה מטבלים",
          en: "Airy Italian focaccia served warm, with five dips",
          ar: "فوكاتشيا إيطالية هشّة تُقدّم ساخنة، مع خمس غموسات",
        },
      },
      {
        he: "טוסט(א)ביב",
        en: "Toast(a)viv",
        ar: "توست (آبيب)",
        price: 45,
        note: {
          he: "טוסט על לחם קסטן עם מוצרלה, שמנת כמהין ופטריות, מוגש לצד סלט ירוקים ואיולי פרמז'ן",
          en: "Toasted chestnut bread with mozzarella, truffle cream and mushrooms, served with a green salad and parmesan aioli",
          ar: "توست على خبز الكستناء مع الموتزاريلا وكريمة الكمأة والفطر، يُقدّم مع سلطة خضراء وأيولي البارميزان",
        },
      },
    ],
  },

  {
    id: "pizzas",
    icon: "🍕",
    title: { he: "פיצות מיוחדות", en: "Specialty Pizzas", ar: "بيتزا مميّزة" },
    items: [
      {
        he: "פיצה מרגריטה",
        en: "Margherita Pizza",
        ar: "بيتزا مارغريتا",
        price: 62,
        note: {
          he: "רוטב עגבניות, בזיליקום ושמן זית",
          en: "Tomato sauce, basil and olive oil",
          ar: "صلصة طماطم، ريحان وزيت زيتون",
        },
      },
      {
        he: "פיצה שום קונפי ורוקט",
        en: "Confit Garlic & Arugula Pizza",
        ar: "بيتزا ثوم كونفيت وجرجير",
        price: 68,
        note: {
          he: "רוטב עגבניות, שמן זית, שום קונפי ועלי רוקט",
          en: "Tomato sauce, olive oil, confit garlic and arugula",
          ar: "صلصة طماطم، زيت زيتون، ثوم كونفيت وأوراق الجرجير",
        },
      },
      {
        he: "פיצה שמנת כמהין ופורטבלו",
        en: "Truffle Cream & Portobello Pizza",
        ar: "بيتزا كريمة الكمأة والبورتوبيلو",
        price: 76,
        note: {
          he: "בצק קריספי, רוטב שמנת כמהין, פטריות פורטבלו טריות, מוצרלה ופרמז'ן",
          en: "Crispy crust, truffle-cream sauce, fresh portobello mushrooms, mozzarella and parmesan",
          ar: "عجينة مقرمشة، صلصة كريمة الكمأة، فطر بورتوبيلو طازج، موتزاريلا وبارميزان",
        },
      },
      {
        he: "פיצה החיים דבש",
        en: "\"Life Is Honey\" Pizza",
        ar: "بيتزا العسل",
        price: 84,
        note: {
          he: "בצק קריספי, רוטב שמנת, מוצרלה, גבינת עזים, זילוף דבש, אגוזי מלך ורוקט",
          en: "Crispy crust, cream sauce, mozzarella, goat cheese, a drizzle of honey, walnuts and arugula",
          ar: "عجينة مقرمشة، صلصة كريمة، موتزاريلا، جبنة الماعز، رشّة عسل، جوز وجرجير",
        },
      },
      {
        he: "פיצה עצבנית — חריפה",
        en: "\"Angry\" Spicy Pizza",
        ar: "بيتزا حارّة",
        price: 68,
        note: {
          he: "רוטב עגבניות חריף, מוצרלה, פלפל חלפיניו, שמן זית ופרמז'ן",
          en: "Spicy tomato sauce, mozzarella, jalapeño, olive oil and parmesan",
          ar: "صلصة طماطم حارّة، موتزاريلا، فلفل هالابينو، زيت زيتون وبارميزان",
        },
      },
      {
        he: "פיצה סגולה",
        en: "Purple Pizza",
        ar: "بيتزا أرجوانية",
        price: 68,
        note: {
          he: "רוטב שמנת, מוצרלה, סלק אפוי, גבינת עיזים ורוקט",
          en: "Cream sauce, mozzarella, roasted beet, goat cheese and arugula",
          ar: "صلصة كريمة، موتزاريلا، شمندر مشوي، جبنة الماعز وجرجير",
        },
      },
      {
        he: "פיצה יוונית",
        en: "Greek Pizza",
        ar: "بيتزا يونانية",
        price: 76,
        note: {
          he: "רוטב עגבניות, מוצרלה, זיתי קלמטה, בצל סגול וגבינת פטה",
          en: "Tomato sauce, mozzarella, Kalamata olives, red onion and feta",
          ar: "صلصة طماطم، موتزاريلا، زيتون كالاماتا، بصل أحمر وجبنة فيتا",
        },
      },
      {
        he: "פיצה פסטו",
        en: "Pesto Pizza",
        ar: "بيتزا بيستو",
        price: 84,
        note: {
          he: "בצק קריספי, מוצרלה, פסטו, גבינת עיזים, עגבניות שרי ואגוזי מלך",
          en: "Crispy crust, mozzarella, pesto, goat cheese, cherry tomatoes and walnuts",
          ar: "عجينة مقرمشة، موتزاريلا، بيستو، جبنة الماعز، طماطم كرزية وجوز",
        },
      },
    ],
  },

  {
    id: "cocktails",
    icon: "🍸",
    title: { he: "קוקטיילים", en: "Cocktails", ar: "الكوكتيلات" },
    note: {
      he: "מחיר כוס / קנקן ענק",
      en: "Price: glass / large pitcher",
      ar: "السعر: كأس / إبريق كبير",
    },
    items: [
      {
        he: "רווקה לדקה",
        en: "Single for a Minute",
        ar: "عزباء لِلحظة",
        price: "52/208",
        note: {
          he: "קוקטייל חמצמץ-מתקתק על בסיס ג'ין, עם טעמים של פסיפלורה וסגירת טוניק",
          en: "Sweet-and-sour gin-based cocktail with passion fruit, finished with tonic",
          ar: "كوكتيل حلو-حامض على أساس الجين بنكهة الباشن فروت ولمسة من التونيك",
        },
      },
      {
        he: "הפנתר הוורוד",
        en: "The Pink Panther",
        ar: "النمر الوردي",
        price: "52/208",
        note: {
          he: "קוקטייל אפריטיף על בסיס טקילה ואפרול, עם טעמים של תות ואשכולית ורודה",
          en: "Tequila-and-Aperol aperitif cocktail with strawberry and pink grapefruit",
          ar: "كوكتيل أبيريتيف على أساس التكيلا والأبيرول بنكهة الفراولة والجريب فروت الوردي",
        },
      },
      {
        he: "ויקום המלפפון",
        en: "Cucumber Welcome",
        ar: "الخيار المُرحِّب",
        price: 54,
        note: {
          he: "קוקטייל מרענן על בסיס ג'ין, עם טעמים של מלפפון, נענע ופרחים",
          en: "Refreshing gin-based cocktail with cucumber, mint and florals",
          ar: "كوكتيل منعش على أساس الجين بنكهة الخيار والنعناع والأزهار",
        },
      },
      {
        he: "חריש והעיר הגדולה",
        en: "Harish and the Big City",
        ar: "حريش والمدينة الكبيرة",
        price: "52/208",
        note: {
          he: "קוקטייל מתקתק על בסיס וודקה, עם טעמים של ליצ'י, למון גראס ונגיעה של חמוציות",
          en: "Sweet vodka-based cocktail with lychee, lemongrass and a touch of cranberry",
          ar: "كوكتيل حلو على أساس الفودكا بنكهة الليتشي وعشبة الليمون ولمسة من التوت البري",
        },
      },
      {
        he: "עולה על שולחנות",
        en: "Up on the Tables",
        ar: "فوق الطاولات",
        price: "46/184",
        note: {
          he: "קוקטייל רענן על בסיס וויסקי, עם טעמים של ליצ'י ונגיעה של מנגו",
          en: "Fresh whiskey-based cocktail with lychee and a touch of mango",
          ar: "كوكتيل منعش على أساس الويسكي بنكهة الليتشي ولمسة من المانجو",
        },
      },
      {
        he: "מונית הביתה",
        en: "Taxi Home",
        ar: "تاكسي إلى البيت",
        price: 54,
        note: {
          he: "קוקטייל פיקנטי על בסיס אוזו, ליצ'י, למון גראס וטוויסט של שאטה",
          en: "Spicy ouzo-based cocktail with lychee, lemongrass and a chili twist",
          ar: "كوكتيل حار على أساس الأوزو، ليتشي، عشبة الليمون ولمسة من الشطة",
        },
      },
      {
        he: "תשעה חודשים",
        en: "Nine Months",
        ar: "تسعة أشهر",
        price: 38,
        note: {
          he: "קוקטייל מתוק ללא אלכוהול, מרענן וטעים",
          en: "Sweet non-alcoholic cocktail — refreshing and tasty",
          ar: "كوكتيل حلو خالٍ من الكحول — منعش ولذيذ",
        },
      },
      {
        he: "בריזר",
        en: "Breezer",
        ar: "بريزر",
        price: 28,
        note: {
          he: "בריזר אבטיח או ליים",
          en: "Watermelon or lime Breezer",
          ar: "بريزر بطيخ أو ليمون أخضر",
        },
      },
    ],
  },

  {
    id: "celebration",
    icon: "🍾",
    title: { he: "חגיגה על השולחן", en: "Celebration on the Table", ar: "احتفال على الطاولة" },
    items: [
      {
        he: "קומבינציה בלוגה",
        en: "Beluga Combo",
        ar: "كومبو بيلوغا",
        price: 750,
        note: {
          he: "בקבוק בלוגה עם 6 אקסלים ומגש מאנץ'",
          en: "Bottle of Beluga vodka with 6 XL energy drinks and a munch platter",
          ar: "زجاجة فودكا بيلوغا مع 6 مشروبات طاقة XL وصينية مقبّلات",
        },
      },
      {
        he: "קומבינציה ערק",
        en: "Arak Combo",
        ar: "كومبو عرق",
        price: 450,
        note: {
          he: "בקבוק ערק עלית עם לימונדה ומגש מאנץ'",
          en: "Bottle of Elite Arak with lemonade and a munch platter",
          ar: "زجاجة عرق إيليت مع ليموناضة وصينية مقبّلات",
        },
      },
      {
        he: "קומבינציה סטולי",
        en: "Stoli Combo",
        ar: "كومبو ستولي",
        price: 570,
        note: {
          he: "בקבוק בלוגה עם 6 אקסלים ומגש מאנץ'",
          en: "Bottle of Beluga vodka with 6 XL energy drinks and a munch platter",
          ar: "زجاجة فودكا بيلوغا مع 6 مشروبات طاقة XL وصينية مقبّلات",
        },
      },
      {
        he: "קאווה BARTENURA",
        en: "Bartenura Cava",
        ar: "كافا بارتينورا",
        price: 310,
        note: {
          he: "יין רוזה מבעבע חצי-יבש (Sparkling Moscato, Italy), האש בראונס מוקרם ופלטת ירקות",
          en: "Semi-dry sparkling rosé (Sparkling Moscato, Italy), creamed hash browns and a vegetable platter",
          ar: "نبيذ روزيه فوّار نصف جاف (موسكاتو فوّار، إيطاليا)، هاش براون بالكريمة وطبق خضار",
        },
      },
      {
        he: "שולחן חברים",
        en: "Friends' Table",
        ar: "طاولة الأصدقاء",
        price: null,
        note: {
          he: "פיצת מרגריטה, 4 שליש בירות מהחבית, נאצ'וס, אדממה וחמוצים",
          en: "Margherita pizza, 4 third-liter draft beers, nachos, edamame and pickles",
          ar: "بيتزا مارغريتا، 4 أكواب بيرة (ثلث لتر) من البرميل، ناتشوز، إدامامي ومخللات",
        },
      },
    ],
  },

  {
    id: "draftBeer",
    icon: "🍺",
    title: { he: "בירות מהחבית", en: "Draft Beer", ar: "بيرة من البرميل" },
    note: {
      he: "מחיר שליש / חצי",
      en: "Price: third / half liter",
      ar: "السعر: ثلث / نصف لتر",
    },
    items: [
      { he: "גולדסטאר", en: "Goldstar", ar: "غولدستار", price: "30/34" },
      { he: "היינקן", en: "Heineken", ar: "هاينكن", price: "30/34" },
      { he: "פאולנר", en: "Paulaner", ar: "باولانر", price: "32/38" },
    ],
  },

  {
    id: "bottledBeer",
    icon: "🍻",
    title: { he: "בירות בבקבוק", en: "Bottled Beer", ar: "بيرة بالزجاجة" },
    items: [
      { he: "גולדסטאר U.F.", en: "Goldstar Unfiltered", ar: "غولدستار غير مفلترة", price: 30 },
      { he: "שפירא IPA", en: "Shapira IPA", ar: "شابيرا IPA", price: 35 },
      { he: "שפירא Pale Ale", en: "Shapira Pale Ale", ar: "شابيرا بيل إيل", price: 32 },
      { he: "היינקן ללא אלכוהול", en: "Heineken 0.0", ar: "هاينكن بدون كحول", price: 22 },
      { he: "בלאנק", en: "Blanc", ar: "بلانك", price: 28 },
      { he: "קסטיל רוז'", en: "Kasteel Rouge", ar: "كاستيل روج", price: 37 },
      { he: "מרפיס", en: "Murphy's", ar: "ميرفيس", price: 38 },
    ],
  },

  {
    id: "combos",
    icon: "🥃",
    title: { he: "שילובים מנצחים", en: "Winning Combos", ar: "مزيج رابح" },
    note: {
      he: "כוס / קנקן",
      en: "Glass / pitcher",
      ar: "كأس / إبريق",
    },
    items: [
      {
        he: "וודקה סטולי",
        en: "Stoli Vodka",
        ar: "فودكا ستولي",
        price: 52,
        note: { he: "עם אקסל או חמוציות", en: "With XL or cranberry", ar: "مع XL أو التوت البري" },
      },
      { he: "ג'ין טוניק", en: "Gin & Tonic", ar: "جين تونيك", price: 56 },
      { he: "ערק לימונים", en: "Arak & Lemon", ar: "عرق بالليمون", price: 48 },
      { he: "וויסקי קולה", en: "Whiskey & Cola", ar: "ويسكي كولا", price: 56 },
      { he: "רום קולה", en: "Rum & Cola", ar: "روم كولا", price: 54 },
      { he: "וואן גוך ספרייט", en: "Van Gogh & Sprite", ar: "فان غوخ سبرايت", price: 56 },
      { he: "קמפרי תפוזים", en: "Campari & Orange", ar: "كامباري برتقال", price: 52 },
      { he: "מוחיטו", en: "Mojito", ar: "موهيتو", price: 52 },
      {
        he: "לימונענע",
        en: "Limonana",
        ar: "ليمون بالنعناع",
        price: "28/48",
        note: { he: "או עם ערק גרוס", en: "Or with crushed arak", ar: "أو مع العرق المجروش" },
      },
      { he: "אוזו 12", en: "Ouzo 12", ar: "أوزو 12", price: 40 },
      {
        he: "טובי",
        en: "Tubi",
        ar: "توبي",
        price: 52,
        note: { he: "עם סודה", en: "With soda", ar: "مع صودا" },
      },
    ],
  },

  {
    id: "barSnacks",
    icon: "🥜",
    title: { he: "ליד הבירה", en: "Alongside the Beer", ar: "مع البيرة" },
    items: [
      {
        he: "נאצ'וס",
        en: "Nachos",
        ar: "ناتشوز",
        price: 28,
        note: { he: "מוגש עם מטבל סלסה", en: "Served with salsa", ar: "يُقدّم مع صلصة السالسا" },
      },
      {
        he: "אדממה",
        en: "Edamame",
        ar: "إدامامي",
        price: 28,
        note: { he: "פולי סויה עם מלח גס ולימון", en: "Soybeans with coarse salt and lemon", ar: "فول الصويا مع ملح خشن وليمون" },
      },
      {
        he: "חמוצי הבית",
        en: "House Pickles",
        ar: "مخللات البيت",
        price: 22,
        note: { he: "מגוון ירקות חמוצים בכבישה ביתית", en: "Assorted house-pickled vegetables", ar: "تشكيلة خضار مخللة منزلياً" },
      },
      {
        he: "מגש מאנץ'",
        en: "Munch Platter",
        ar: "صينية المقبّلات",
        price: null,
        note: {
          he: "מגש גדול מלא בפינוקים: נאצ'וס, אדממה וחמוצי הבית, בליווי סלסת הבית",
          en: "A large platter loaded with treats: nachos, edamame and house pickles with house salsa",
          ar: "صينية كبيرة مليئة بالمقبّلات: ناتشوز، إدامامي ومخللات البيت مع صلصة السالسا",
        },
      },
    ],
  },

  {
    id: "whiskey",
    icon: "🥃",
    title: { he: "וויסקי", en: "Whiskey", ar: "ويسكي" },
    note: { he: "60 מ\"ל", en: "60 ml", ar: "60 مل" },
    items: [
      { he: "ג'וני ווקר שחור", en: "Johnnie Walker Black", ar: "جوني ووكر بلاك", price: 56 },
      { he: "ג'ק דניאלס", en: "Jack Daniel's", ar: "جاك دانيلز", price: 48 },
      { he: "ג'ק דניאלס דבש", en: "Jack Daniel's Honey", ar: "جاك دانيلز عسل", price: 48 },
      { he: "גלנליווט 12", en: "Glenlivet 12", ar: "غلنليفيت 12", price: 58 },
      { he: "גלנליווט 15", en: "Glenlivet 15", ar: "غلنليفيت 15", price: 72 },
      { he: "גלנליווט 18", en: "Glenlivet 18", ar: "غلنليفيت 18", price: 92 },
      { he: "ג'יימסון", en: "Jameson", ar: "جيمسون", price: 46 },
    ],
  },

  {
    id: "chasers",
    icon: "🍶",
    title: { he: "צ'ייסרים", en: "Chasers", ar: "تشيسر" },
    note: {
      he: "1 ב-18 ₪ | 4 ב-50 ₪",
      en: "1 for ₪18 | 4 for ₪50",
      ar: "1 بـ 18 ₪ | 4 بـ 50 ₪",
    },
    items: [
      { he: "ערק", en: "Arak", ar: "عرق", price: 18 },
      { he: "ג'יימסון", en: "Jameson", ar: "جيمسون", price: 18 },
      { he: "וודקה סטולי", en: "Stoli Vodka", ar: "فودكا ستولي", price: 18 },
      { he: "ג'ין גורדונס", en: "Gordon's Gin", ar: "جين غوردنز", price: 18 },
      { he: "קמפרי", en: "Campari", ar: "كامباري", price: 18 },
      { he: "טקילה אוקלהומה", en: "Oklahoma Tequila", ar: "تكيلا أوكلاهوما", price: 18 },
      { he: "פידג'", en: "Fidj", ar: "فيدج", price: 18 },
    ],
  },

  {
    id: "premiumChasers",
    icon: "✨",
    title: { he: "צ'ייסרים בגבוהה", en: "Premium Chasers", ar: "تشيسر مميّز" },
    note: {
      he: "1 ב-22 ₪ | 4 ב-70 ₪",
      en: "1 for ₪22 | 4 for ₪70",
      ar: "1 بـ 22 ₪ | 4 بـ 70 ₪",
    },
    items: [
      { he: "וואן גוך טעמים", en: "Van Gogh (flavored)", ar: "فان غوخ بنكهات", price: 22 },
      { he: "ייגרמייסטר", en: "Jägermeister", ar: "يغرمايستر", price: 22 },
      { he: "ג'ק דניאלס", en: "Jack Daniel's", ar: "جاك دانيلز", price: 22 },
      { he: "ג'ק דניאלס יבש", en: "Jack Daniel's (dry)", ar: "جاك دانيلز (جاف)", price: 22 },
      { he: "בלוגה", en: "Beluga", ar: "بيلوغا", price: 22 },
      { he: "טקילה פטרון", en: "Patrón Tequila", ar: "تكيلا باترون", price: 22 },
      { he: "קמפרי", en: "Campari", ar: "كامباري", price: 22 },
    ],
  },

  {
    id: "snooker",
    icon: "🎱",
    title: { he: "סנוקר", en: "Snooker", ar: "سنوكر" },
    items: [
      {
        he: "הזמנת משחק",
        en: "Game Booking",
        ar: "حجز لعبة",
        price: 35,
        note: { he: "לחצי שעה", en: "Per half hour", ar: "لنصف ساعة" },
      },
    ],
  },

  {
    id: "hookah",
    icon: "💨",
    title: { he: "נרגילה", en: "Hookah", ar: "أرجيلة" },
    items: [
      {
        he: "ראש נרגילה",
        en: "Hookah Head",
        ar: "رأس أرجيلة",
        price: 45,
        note: { he: "ראש איכותי בטעמים שונים", en: "Premium head in assorted flavors", ar: "رأس فاخر بنكهات متنوعة" },
      },
    ],
  },

  {
    id: "desserts",
    icon: "🍰",
    title: { he: "קינוחים", en: "Desserts", ar: "الحلويات" },
    items: [
      { he: "שוקולד נמסיס חם", en: "Hot Chocolate Nemesis", ar: "نيميسيس الشوكولاتة الساخن", price: 48 },
      { he: "קרמבל תפוחים", en: "Apple Crumble", ar: "كرامبل التفاح", price: 50 },
      { he: "פאי פירות יער", en: "Forest Berry Pie", ar: "فطيرة توت الغابة", price: 50 },
      { he: "קראק פאי פיסטוק", en: "Pistachio Crack Pie", ar: "كراك باي بالفستق", price: null },
    ],
  },

  {
    id: "wines",
    icon: "🍷",
    title: { he: "יינות ומבעבעים", en: "Wines & Sparkling", ar: "النبيذ والفوّار" },
    note: {
      he: "מחיר כוס / בקבוק",
      en: "Price: glass / bottle",
      ar: "السعر: كأس / زجاجة",
    },
    items: [
      {
        he: "יין לבן הבית",
        en: "House White",
        ar: "النبيذ الأبيض للبيت",
        price: "49/139",
        note: { he: "תשאלו את המלצר", en: "Ask your server", ar: "اسألوا النادل" },
      },
      {
        he: "יין אדום הבית",
        en: "House Red",
        ar: "النبيذ الأحمر للبيت",
        price: "41/139",
        note: { he: "תשאלו את המלצר", en: "Ask your server", ar: "اسألوا النادل" },
      },
      {
        he: "יין רוזה הבית",
        en: "House Rosé",
        ar: "نبيذ الروزيه للبيت",
        price: "41/139",
        note: { he: "תשאלו את המלצר", en: "Ask your server", ar: "اسألوا النادل" },
      },
    ],
  },

  {
    id: "softDrinks",
    icon: "🥤",
    title: { he: "שתייה קלה", en: "Soft Drinks", ar: "مشروبات خفيفة" },
    items: [
      { he: "תפוזים סחוט", en: "Fresh Orange Juice", ar: "عصير برتقال طازج", price: 18 },
      { he: "מיץ לימונדה טבעי", en: "Natural Lemonade", ar: "ليموناضة طبيعية", price: 12 },
      {
        he: "קוקה קולה",
        en: "Coca-Cola",
        ar: "كوكا كولا",
        price: 14,
        note: { he: "רגיל או זירו", en: "Regular or Zero", ar: "عادي أو زيرو" },
      },
      { he: "ספרייט", en: "Sprite", ar: "سبرايت", price: 14 },
      { he: "סודה", en: "Soda", ar: "صودا", price: 9 },
      { he: "מים מינרלים", en: "Mineral Water", ar: "مياه معدنية", price: 12 },
      { he: "פיוז טי", en: "Fuze Tea", ar: "فيوز تي", price: 14 },
      { he: "אקסל", en: "XL Energy Drink", ar: "مشروب طاقة XL", price: 12 },
    ],
  },
];

// Single source for the menu page.
const MENU = {
  name: { he: "אייכה בר", en: "Eicha Bar", ar: "إيخا بار" }, // ⚠️ confirm Arabic spelling
  badges: BADGES,
  categories: CATEGORIES,
};

// Expose for the browser and (optionally) Node tooling.
if (typeof window !== "undefined") {
  window.MENU = MENU;
  window.BADGES = BADGES;
}
if (typeof module !== "und