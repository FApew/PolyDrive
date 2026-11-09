import iro from "@jaames/iro"

import { defaultColor, setCarColor } from "./main"
import { OculusHandModel } from "three/examples/jsm/Addons.js"

//note - HTML Elements
const join = document.getElementById("join")
const create = document.getElementById("create")
const customize = document.getElementById("customize")
const settings = document.getElementById("settings")
const sideBar = document.getElementById("sideBar")

//Global Vars
let sideBarVal = 0, lastSideBarVal = 0
let firstCustomize = true
let lastColor: number

//NOTE - "customize" Events
customize!.addEventListener("click", () => {
    if (firstCustomize == true) {
        lastColor = defaultColor
        firstCustomize = false
    }

    sideBarVal = sideBarVal == 1 ? 0 : 1
    updateSideBar()
})

//NOTE - "settings" Events
settings!.addEventListener("click", () => {
    sideBarVal = sideBarVal == 2 ? 0 : 2
    updateSideBar()
})

//FUNCTION - async updateSideBar()
async function updateSideBar() {
    if (sideBarVal == 0) { //SideBar closed
        await closeSideBar()
    } else { //Open SideBar
        if (lastSideBarVal != 0) { //Close to change the SideBar
            await closeSideBar()
        }

        switch (sideBarVal) {
            case 1: { customizeUI(); break } //Customize
            case 2: { settingsUI(); break } //Settings
        }

        sideBar!.classList.add("selected")
    }

    lastSideBarVal = sideBarVal

    //fun - closeSideBar()
    async function closeSideBar() {
        sideBar!.classList.remove("selected")
        await new Promise((res) => {setTimeout(res, 100)})
        sideBar!.innerHTML = ""
    }

    //fun - customizeUI()
    function customizeUI() {
        //note - sideBar Grid Layout
        sideBar!.style.display = "grid"
        sideBar!.style.gridTemplateColumns = "1fr"
        sideBar!.style.gridTemplateRows = "repeat(2, 0.15fr 1fr)"

        //note - modelSliderLabel Creation
        const modelSliderLabel = document.createElement("div")
        modelSliderLabel.id = "modelSliderLabel"
        modelSliderLabel.classList.add("sideBarLabel")
        modelSliderLabel.innerHTML = "Model: "

        sideBar!.appendChild(modelSliderLabel)

        //note - modelSlider Creation
        const modelSlider = document.createElement("div")
        modelSlider.id = "modelSlider"

        sideBar!.appendChild(modelSlider)

        //note - colorPickerLabel Creation
        const colorPickerLabel = document.createElement("div")
        colorPickerLabel.id = "colorPickerLabel"
        colorPickerLabel.classList.add("sideBarLabel")
        colorPickerLabel.innerHTML = "Color: "

        sideBar!.appendChild(colorPickerLabel)

        //note - colorPicker Creation
        const colorPicker = document.createElement("div")
        colorPicker.id = "colorPicker"

        sideBar!.appendChild(colorPicker)

        const iroJSbox = document.createElement("div")
        iroJSbox.id = "iroJSbox"

        colorPicker.appendChild(iroJSbox)

        const pickerWidth = iroJSbox.clientWidth * 0.8
        const hex = `#${(lastColor).toString(16)}`;

        //note - iroJS Picker
        const picker: iro.ColorPicker = iro.ColorPicker("#iroJSbox", {
            width: pickerWidth,
            color: hex,
            borderWidth: 2,
            borderColor: "#fff",
            layout: [
                {component: iro.ui.Wheel},
                {component: iro.ui.Slider, options: {sliderType: "saturation"}},
                {component: iro.ui.Slider}
            ]
        })

        //note - currentColor Display
        const currentColor = document.createElement("div")
        currentColor.id = "currentColor"
        updateColorUI(picker.color)

        colorPicker.appendChild(currentColor)

        picker.on("color:change", (color: iro.Color) => {
            updateColorUI(color)
        })

        //fun - updateColorUI()
        function updateColorUI(color: iro.Color) {
            currentColor.style.background = color.hexString
            currentColor.innerHTML = color.hexString

            const {r, g, b} = color.rgb
            const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255

            currentColor.style.color = l > 0.5 ? "#000" : "#fff"

            lastColor = parseInt(color.hexString.replace("#", ""), 16);
            setCarColor(lastColor)
        }
    }

    //fun - settingsUI()
    function settingsUI() {
        //note - sideBar Grid Layout
        sideBar!.style.display = "flex"
        sideBar!.style.flexDirection = "column"

        //note - settingLabel Creation
        const settingLabel = document.createElement("div")
        settingLabel.id = "modelSliderLabel"
        settingLabel.classList.add("sideBarLabel")
        settingLabel.innerHTML = "Settings: "

        sideBar!.appendChild(settingLabel)
    }
}
//!FUNCTION