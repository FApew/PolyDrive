import * as THREE from "three"
import iro from "@jaames/iro"

import { currentCarVisuals, setCarColor, createLobby, leaveLobby, joinLobby, topRightInfo, changeModel } from "./main"

import { config } from "../../shared/YAMLConfigs"
import { imgs, modelList } from "./assetsLoader"
import type { CarModelName } from "../../shared/types"

//note - HTML Elements
const join_ready = document.getElementById("join") as HTMLDivElement
const codeInput = document.getElementById("codeInput") as HTMLInputElement
const create_leave = document.getElementById("create") as HTMLDivElement
const customize = document.getElementById("customize") as HTMLDivElement
const settings = document.getElementById("settings") as HTMLDivElement
const sideBar = document.getElementById("sideBar") as HTMLDivElement
const topRightInfoElement = document.getElementById("topRightInfo") as HTMLDivElement

//Global Vars
let sideBarVal = 0, lastSideBarVal = 0
let firstCustomize = true
let lastColor: THREE.ColorRepresentation //Cool Colors: #b03c40 #735bc2 #10713b

//NOTE "JOIN & READY" Events
join_ready.addEventListener("click", async (e) => {
    const target = e.target as HTMLDivElement

    if (target.id == "join") {
        const code: string = codeInput.value.toUpperCase()
        if (code.length < 5) {alert("Enter a 5 digit code"); return}

        if (!await joinLobby(code)) { console.log("test"); alert("Code is invalid") }

    } else if (target.id == "ready") { console.log("brao") }
})

//NOTE - "CREATE & LEAVE" Events
create_leave.addEventListener("click", (e) => {
    const target = e.target as HTMLDivElement

    if (target.id == "create") { createLobby() }
    else if (target.id == "leave") { leaveLobby() }
})

//NOTE - "customize" Events
customize.addEventListener("click", () => {
    if (firstCustomize == true) {
        lastColor = currentCarVisuals.color
        firstCustomize = false
    }

    sideBarVal = sideBarVal == 1 ? 0 : 1
    updateSideBar()
})

//NOTE - "settings" Events
settings.addEventListener("click", () => {
    sideBarVal = sideBarVal == 2 ? 0 : 2
    updateSideBar()
})

//FUNCTION - async updateSideBar()
async function updateSideBar(): Promise<void> {
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

        sideBar.classList.add("selected")
    }

    lastSideBarVal = sideBarVal

    //fun - closeSideBar()
    async function closeSideBar(): Promise<void> {
        sideBar.classList.remove("selected")
        await new Promise((res) => {setTimeout(res, 100)})
        sideBar.innerHTML = ""
    }

    //fun - customizeUI()
    function customizeUI(): void {
        //note - sideBar Grid Layout
        sideBar.style.display = "grid"
        sideBar.style.gridTemplateColumns = "1fr"
        sideBar.style.gridTemplateRows = "repeat(2, 0.15fr 1fr)"

        //note - modelSliderLabel Creation
        const modelSliderLabel = document.createElement("div")
        modelSliderLabel.id = "modelSliderLabel"
        modelSliderLabel.classList.add("sideBarLabel")
        modelSliderLabel.innerHTML = "Model: "

        sideBar.appendChild(modelSliderLabel)

        //note - modelSlider Creation

        const modelOuterBox = document.createElement("div")
        modelOuterBox.id = "modelOuterBox"

        const modelSlider = document.createElement("div")
        modelSlider.id = "modelSlider"

        modelList.forEach((model: CarModelName) => {
            const elm = document.createElement("div")
            elm.classList.add("modelSelect")

            elm.addEventListener("click", () => {
                changeModel(model)
            })
            
            const logo = document.createElement("div")
            logo.classList.add("carLogo")
            logo.style.backgroundImage = `url(${imgs[model]})`

            elm.appendChild(logo)

            const label = document.createElement("div")
            label.classList.add("logoLabel")
            label.innerHTML = model

            elm.appendChild(label)

            modelSlider.appendChild(elm)
        })

        modelOuterBox.appendChild(modelSlider)
        sideBar.appendChild(modelOuterBox)

        //note - colorPickerLabel Creation
        const colorPickerLabel = document.createElement("div")
        colorPickerLabel.id = "colorPickerLabel"
        colorPickerLabel.classList.add("sideBarLabel")
        colorPickerLabel.innerHTML = "Color: "

        sideBar.appendChild(colorPickerLabel)

        //note - colorPicker Creation
        const colorPicker = document.createElement("div")
        colorPicker.id = "colorPicker"

        sideBar.appendChild(colorPicker)

        const iroJSbox = document.createElement("div")
        iroJSbox.id = "iroJSbox"

        colorPicker.appendChild(iroJSbox)

        const pickerWidth = iroJSbox.clientWidth * 0.8
        const hex = `#${(lastColor).toString(16).padStart(6, "0")}`;

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
        function updateColorUI(color: iro.Color): void {
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
    function settingsUI(): void {
        //note - sideBar Grid Layout
        sideBar.style.display = "flex"
        sideBar.style.flexDirection = "column"

        //note - settingLabel Creation
        const settingLabel = document.createElement("div")
        settingLabel.id = "modelSliderLabel"
        settingLabel.classList.add("sideBarLabel")
        settingLabel.innerHTML = "Settings: "

        sideBar.appendChild(settingLabel)
    }
}
//!FUNCTION

//fun updateInfos()
export function updateInfos(): void {
    topRightInfoElement.innerHTML = ""

    topRightInfoElement.innerHTML = "User: "
    
    const usernameInput = document.createElement("input")
    usernameInput.id = "usernameInput"
    usernameInput.maxLength = config.game.username_lenght
    usernameInput.placeholder = "<NAME>"
    usernameInput.value = topRightInfo.username
    resizeInput()

    topRightInfoElement.appendChild(usernameInput)

    usernameInput.addEventListener("input", resizeInput)

    if (topRightInfo.code) {
        const codeElm = document.createElement("div")
        codeElm.innerHTML = `Code: ${ topRightInfo.code }`
        codeElm.style.justifySelf = "end"
        topRightInfoElement.appendChild(codeElm)
    }

    const modelElm = document.createElement("div")
    modelElm.innerHTML = `Model: ${
        topRightInfo.carVisuals.model.charAt(0).toUpperCase() + topRightInfo.carVisuals.model.slice(1)
    }`
    modelElm.style.justifySelf = "end"
    topRightInfoElement.appendChild(modelElm)

    const colorElm = document.createElement("div")
    colorElm.innerHTML = `Color: #${ (topRightInfo.carVisuals.color).toString(16).padStart(6, "0") }`
    colorElm.style.justifySelf = "end"
    topRightInfoElement.appendChild(colorElm)

    //fun - resizeInput
    function resizeInput(): void {
        const charN = Math.max(usernameInput.value.length + 1, 7)
        usernameInput.style.width = `${charN}ch`
        topRightInfo.username = usernameInput.value
    }
}